'use strict'

const { keywordMetricProvenance } = require('../provenance')

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 180) || 'topic'
  )
}

function isSlugConflict(err) {
  const msg = String(err?.message || '')
  return msg.includes('23505') && msg.includes('topics_slug_key')
}

/**
 * Load every existing topics.slug (global unique constraint).
 * topics.slug is not map-scoped, so imports must avoid collisions with other maps.
 */
async function loadExistingSlugs(supaFetch) {
  const used = new Set()
  const pageSize = 1000
  let offset = 0
  for (;;) {
    const rows = await supaFetch(
      `/topics?select=slug&limit=${pageSize}&offset=${offset}`,
      { useServiceRole: true }
    )
    const batch = Array.isArray(rows) ? rows : []
    for (const row of batch) {
      if (row?.slug) used.add(String(row.slug))
    }
    if (batch.length < pageSize) break
    offset += pageSize
  }
  return used
}

function allocateUniqueSlug(base, usedSlugs) {
  const root = slugify(base)
  let s = root
  let i = 2
  while (usedSlugs.has(s)) s = `${root}-${i++}`
  usedSlugs.add(s)
  return s
}

function walkStructureNodes(structure, visit) {
  for (const branch of structure.pillars || []) {
    visit(branch.pillar)
    for (const c of branch.clusters || []) {
      visit(c)
      for (const s of c.supporting || []) visit(s)
    }
  }
}

/**
 * Assign DB-unique slugs for every node, then rewrite internal_links_to.
 * Returns Map originalSlug -> finalSlug (identity when unchanged).
 */
function assignSlugsAgainstUsed(structure, usedSlugs) {
  const remap = new Map()
  walkStructureNodes(structure, (node) => {
    const original = slugify(node.slug || node.title)
    const final = allocateUniqueSlug(original, usedSlugs)
    node.slug = final
    remap.set(original, final)
    if (original !== final) remap.set(final, final)
  })

  walkStructureNodes(structure, (node) => {
    const links = node.internal_links_to || []
    node.internal_links_to = [
      ...new Set(
        links
          .map((slug) => remap.get(slug) || slug)
          .filter((slug) => slug && slug !== node.slug)
      ),
    ]
  })

  return remap
}

async function deleteOrphanMap(supaFetch, mapId) {
  if (!mapId) return
  try {
    await supaFetch(`/topics?map_id=eq.${mapId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  } catch {
    // best-effort
  }
  try {
    await supaFetch(`/topical_maps?id=eq.${mapId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  } catch {
    // best-effort
  }
}

/**
 * Persist a consolidated structure as a new topical_maps row + topics tree.
 * Uses the same column set as stageSave (parents first).
 *
 * topics.slug is globally unique across maps. We reserve slugs against the
 * live DB set and retry on 23505 races.
 */
async function persistImportedMap({
  structure,
  mapName,
  seedKeyword,
  coreComponents,
  source,
  warnings,
  counts,
  supaFetch,
}) {
  const nowIso = new Date().toISOString()
  const name =
    mapName ||
    `Imported: CryptoKiller Topical Map (${nowIso.slice(0, 10)})`

  const usedSlugs = await loadExistingSlugs(supaFetch)
  assignSlugsAgainstUsed(structure, usedSlugs)

  const mapInsert = await supaFetch('/topical_maps?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name,
      description: `Imported topical map from spreadsheet (${source || 'sheet-import'}).`,
      status: 'active',
      seed_keyword: seedKeyword || 'crypto scams',
      core_components: coreComponents || null,
      stats: {
        imported_by: 'sheet-import',
        source: source || 'upload',
        topic_count: 0,
        pillar_count: counts?.pillars || 0,
        cluster_count: counts?.clusters || 0,
        supporting_count: counts?.supporting || 0,
        warnings: (warnings || []).slice(0, 20),
        imported_at: nowIso,
      },
    }),
  })
  const mapRow = Array.isArray(mapInsert) ? mapInsert[0] : mapInsert
  const mapId = mapRow?.id
  if (!mapId) throw new Error('Failed to create topical_maps row')

  const insertTopic = async (node, { parentId, topicType, section, sortOrder }) => {
    let attempt = 0
    let lastError = null
    // Pre-assigned by assignSlugsAgainstUsed; retries only on race conflicts.
    const preferred = slugify(node.slug || node.title)

    while (attempt < 30) {
      const candidate =
        attempt === 0 ? preferred : allocateUniqueSlug(preferred, usedSlugs)
      if (attempt === 0) usedSlugs.add(candidate)
      node.slug = candidate

      const row = {
        map_id: mapId,
        parent_id: parentId,
        topic_type: topicType,
        content_type: node.content_type || 'educational',
        title: node.title,
        slug: candidate,
        description: node.description || null,
        target_keyword: node.target_keyword || null,
        secondary_keywords: node.secondary_keywords || [],
        search_volume: node.search_volume ?? 0,
        keyword_difficulty: node.keyword_difficulty ?? 0,
        business_value: node.business_value ?? 50,
        priority_score: node.priority_score ?? 0,
        content_status: 'planned',
        brand_id: null,
        review_id: null,
        dependencies: node.dependencies || [],
        internal_links_to: node.internal_links_to || [],
        sort_order: sortOrder,
        notes: node.notes || null,
        updated_at: nowIso,
        section,
        search_intent: node.search_intent || null,
        cpc: null,
        volume_trend_yearly: null,
        traffic_potential: null,
        parent_topic: null,
        serp_authority: null,
        keyword_data_source: node.keyword_data_source || 'unverified',
        metric_provenance: node.metric_provenance || keywordMetricProvenance(node.keyword_data_source),
        page_role: topicType === 'pillar' ? 'Root' : topicType === 'cluster' ? 'Core' : 'Outer',
        macro_vector: null,
        node_type: node.node_type || 'standard',
        node_function: node.node_function || null,
        url_path: node.url_path || null,
        content_format: node.content_format || null,
        schema_type: node.schema_type || null,
        format_code: null,
        aio_risk: null,
        fan_out_tag: null,
        serp_features: [],
        competitor_urls: [],
        paa_questions: [],
        cluster_key: node.cluster_key || null,
        publication_wave: node.publication_wave ?? null,
        qa_flags: [],
        content_role: node.content_role || null,
        expands_content_slug: null,
      }

      try {
        const inserted = await supaFetch('/topics?select=id,slug', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row),
        })
        const item = Array.isArray(inserted) ? inserted[0] : inserted
        if (!item?.id) throw new Error(`Failed to insert topic: ${node.title}`)
        return { id: item.id, slug: candidate }
      } catch (e) {
        lastError = e
        if (isSlugConflict(e)) {
          usedSlugs.add(candidate)
          attempt += 1
          continue
        }
        throw e
      }
    }

    throw new Error(
      `Unable to allocate unique topic slug for "${node.title}": ${lastError?.message || 'unknown'}`
    )
  }

  try {
    let topicCount = 0
    let pi = 0
    for (const branch of structure.pillars || []) {
      const pillar = await insertTopic(branch.pillar, {
        parentId: null,
        topicType: 'pillar',
        section: branch.section,
        sortOrder: pi++,
      })
      topicCount += 1
      let ci = 0
      for (const c of branch.clusters || []) {
        const cluster = await insertTopic(c, {
          parentId: pillar.id,
          topicType: 'cluster',
          section: branch.section,
          sortOrder: ci++,
        })
        topicCount += 1
        let si = 0
        for (const s of c.supporting || []) {
          await insertTopic(s, {
            parentId: cluster.id,
            topicType: 'supporting',
            section: branch.section,
            sortOrder: si++,
          })
          topicCount += 1
        }
      }
    }

    await supaFetch(`/topical_maps?id=eq.${mapId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        stats: {
          imported_by: 'sheet-import',
          source: source || 'upload',
          topic_count: topicCount,
          pillar_count: counts?.pillars || structure.pillars.length,
          cluster_count: counts?.clusters || 0,
          supporting_count: counts?.supporting || 0,
          warnings: (warnings || []).slice(0, 20),
          imported_at: nowIso,
        },
        updated_at: nowIso,
      }),
    })

    return { map_id: mapId, map_name: name, topic_count: topicCount }
  } catch (err) {
    await deleteOrphanMap(supaFetch, mapId)
    throw err
  }
}

module.exports = {
  persistImportedMap,
  allocateUniqueSlug,
  assignSlugsAgainstUsed,
  isSlugConflict,
  slugify,
}
