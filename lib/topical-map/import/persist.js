'use strict'

const { keywordMetricProvenance } = require('../provenance')
const { DEFAULT_CADENCE } = require('../publication-plan')
const { persistScheduleOnTopics } = require('../publication-schedule')
const {
  loadPublishedCatalog,
  matchPublishedArticle,
  publishedLinkFields,
} = require('./link-existing')

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

/**
 * Free globally-unique slugs owned by a map that will be replaced.
 * Renames each topic slug to a retired form so the upcoming import can
 * reclaim clean names, while the old map stays intact until deleteOrphanMap
 * runs after a successful persist (never delete-before-write).
 */
async function retireMapSlugs(supaFetch, mapId) {
  if (!mapId) return { retired: 0 }
  const pageSize = 1000
  let offset = 0
  let retired = 0
  for (;;) {
    const rows = await supaFetch(
      `/topics?map_id=eq.${mapId}&select=id,slug&limit=${pageSize}&offset=${offset}`,
      { useServiceRole: true }
    )
    const batch = Array.isArray(rows) ? rows : []
    for (const row of batch) {
      if (!row?.id || !row?.slug) continue
      const short = String(row.id).replace(/-/g, '').slice(0, 8)
      const next = `${String(row.slug).slice(0, 160)}-retired-${short}`
      await supaFetch(`/topics?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ slug: next }),
      })
      retired += 1
    }
    if (batch.length < pageSize) break
    offset += pageSize
  }
  return { retired }
}

/**
 * Hard-delete an orphan map and its topics (topics first, then the map row,
 * since topics.map_id references topical_maps). Never swallows failures:
 * callers must check `cleaned` and treat `false` as critical, since a
 * failed cleanup leaves a partial map/topic tree behind in the database.
 */
async function deleteOrphanMap(supaFetch, mapId) {
  if (!mapId) return { cleaned: true, errors: [] }
  const errors = []
  try {
    await supaFetch(`/topics?map_id=eq.${mapId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  } catch (e) {
    errors.push(`topics: ${e.message}`)
  }
  try {
    await supaFetch(`/topical_maps?id=eq.${mapId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  } catch (e) {
    errors.push(`map: ${e.message}`)
  }
  return { cleaned: errors.length === 0, errors }
}

/**
 * Count topics currently persisted for a map, paginating through
 * PostgREST's row cap. Used as the post-insert integrity check: the
 * shared `supaFetch` wrapper returns parsed bodies only (no response
 * headers), so a HEAD + Prefer: count=exact request cannot report a
 * total here; walking select=id pages is the count strategy that
 * actually works through this interface.
 */
async function countTopicsForMap(supaFetch, mapId) {
  const pageSize = 1000
  let offset = 0
  let total = 0
  for (;;) {
    const rows = await supaFetch(
      `/topics?map_id=eq.${mapId}&select=id&limit=${pageSize}&offset=${offset}`,
      { useServiceRole: true }
    )
    const batch = Array.isArray(rows) ? rows : []
    total += batch.length
    if (batch.length < pageSize) break
    offset += pageSize
  }
  return total
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
  // Match sheet url_path leaf (and slug) to live published content/reviews so
  // already-written pages land as published + linked, not blank Write targets.
  const publishedCatalog = await loadPublishedCatalog(supaFetch)
  const linkedExisting = { content: 0, reviews: 0 }

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

  const insertedTopics = []
  const startDate = nowIso.slice(0, 10)

  const insertTopic = async (node, { parentId, topicType, section, sortOrder }) => {
    let attempt = 0
    let lastError = null
    // Pre-assigned by assignSlugsAgainstUsed; retries only on race conflicts.
    const preferred = slugify(node.slug || node.title)
    // Match url_path leaf (and slug) to live published pages before insert.
    const existingMatch = matchPublishedArticle(
      { ...node, topic_type: topicType },
      publishedCatalog
    )
    const linkFields = publishedLinkFields(existingMatch)

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
        keyword_difficulty: node.keyword_difficulty == null ? null : node.keyword_difficulty,
        business_value: node.business_value ?? 50,
        priority_score: node.priority_score ?? 0,
        content_status: linkFields.content_status,
        brand_id: null,
        review_id: linkFields.review_id,
        content_id: linkFields.content_id,
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
        qa_flags: Array.isArray(node.qa_flags) ? node.qa_flags : [],
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

        if (existingMatch?.kind === 'content') {
          linkedExisting.content += 1
          if (!existingMatch.topic_id) {
            try {
              await supaFetch(`/content?id=eq.${encodeURIComponent(existingMatch.id)}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ topic_id: item.id }),
              })
            } catch {
              // Non-fatal: topic already has content_id.
            }
          }
        } else if (existingMatch?.kind === 'review') {
          linkedExisting.reviews += 1
        }

        insertedTopics.push({
          id: item.id,
          topic_type: topicType,
          title: node.title,
          target_keyword: node.target_keyword || null,
          notes: node.notes || null,
          qa_flags: Array.isArray(node.qa_flags) ? node.qa_flags : [],
          rolling_placeholder: node.rolling_placeholder === true,
          content_status: linkFields.content_status,
          content_id: linkFields.content_id,
          review_id: linkFields.review_id,
          publication_wave: node.publication_wave ?? null,
          priority_score: node.priority_score ?? 0,
          sort_order: sortOrder,
        })

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
    let pillarCount = 0
    let clusterCount = 0
    let supportingCount = 0
    let pi = 0
    for (const branch of structure.pillars || []) {
      const pillar = await insertTopic(branch.pillar, {
        parentId: null,
        topicType: 'pillar',
        section: branch.section,
        sortOrder: pi++,
      })
      topicCount += 1
      pillarCount += 1
      let ci = 0
      for (const c of branch.clusters || []) {
        const cluster = await insertTopic(c, {
          parentId: pillar.id,
          topicType: 'cluster',
          section: branch.section,
          sortOrder: ci++,
        })
        topicCount += 1
        clusterCount += 1
        let si = 0
        for (const s of c.supporting || []) {
          await insertTopic(s, {
            parentId: cluster.id,
            topicType: 'supporting',
            section: branch.section,
            sortOrder: si++,
          })
          topicCount += 1
          supportingCount += 1
        }
      }
    }

    // Integrity check: confirm the DB actually holds every topic we just
    // inserted before declaring success. A mismatch (partial write, RLS
    // silently dropping rows, etc.) must not leave a half-built map behind.
    const actualCount = await countTopicsForMap(supaFetch, mapId)
    if (actualCount !== topicCount) {
      throw new Error(
        `Import count mismatch for map ${mapId}: inserted ${topicCount} topics but database has ${actualCount}.`
      )
    }

    const schedule = await persistScheduleOnTopics(supaFetch, insertedTopics, {
      cadence: DEFAULT_CADENCE,
      startDate,
    })

    await supaFetch(`/topical_maps?id=eq.${mapId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        stats: {
          imported_by: 'sheet-import',
          source: source || 'upload',
          topic_count: topicCount,
          pillar_count: pillarCount,
          cluster_count: clusterCount,
          supporting_count: supportingCount,
          linked_existing: linkedExisting,
          warnings: (warnings || []).slice(0, 20),
          imported_at: nowIso,
          publication: {
            cadence: schedule.config.cadence,
            perWeek: schedule.config.perWeek,
            start_date: schedule.config.start_date,
            scheduled_count: schedule.scheduled_count,
          },
        },
        updated_at: nowIso,
      }),
    })

    return {
      map_id: mapId,
      map_name: name,
      topic_count: topicCount,
      linked_existing: linkedExisting,
    }
  } catch (err) {
    const cleanup = await deleteOrphanMap(supaFetch, mapId)
    if (!cleanup.cleaned) {
      err.message = `${err.message} CRITICAL: orphan map ${mapId} was not fully removed (${(cleanup.errors || []).join('; ')}). Manual cleanup required.`
    } else {
      err.message = `${err.message} Orphan map ${mapId} was removed.`
    }
    err.cleanup = cleanup
    throw err
  }
}

module.exports = {
  persistImportedMap,
  deleteOrphanMap,
  retireMapSlugs,
  countTopicsForMap,
  allocateUniqueSlug,
  assignSlugsAgainstUsed,
  isSlugConflict,
  slugify,
}
