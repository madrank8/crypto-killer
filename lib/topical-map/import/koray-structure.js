'use strict'

const { buildTopicFields, cleanUrlPath } = require('./field-map')
const { slugify } = require('../text-utils')
const { computeTopicPriorityScore } = require('../../content-prompts')

/**
 * Growth Partner consolidation map (Option B).
 * Cluster numbers → pillar grouping with optional nested clusters.
 */
const CORE_PILLAR_DEFS = [
  {
    key: 'crypto-scams',
    title: 'Crypto Scams: Types, Warning Signs & How to Check Any Platform',
    url_path: '/crypto-scams/',
    target_keyword: 'crypto scams',
    section: 'core',
    cluster_numbers: [1, 2],
    // Prefer hub row from sheet cluster 1 when present
    hub_match: (p) => p.cluster_number === 1 && /\/crypto-scams\/\s*$/.test(p.url_path || ''),
    children: [
      {
        kind: 'spokes',
        title: 'Entity & Hub Spokes',
        // Pages from cluster 1 that are NOT the pillar hub itself
        filter: (p) => p.cluster_number === 1 && !/\/crypto-scams\/\s*$/.test(p.url_path || ''),
      },
      {
        kind: 'wiki',
        title: 'Scam Type Wiki',
        filter: (p) => p.cluster_number === 2,
      },
    ],
  },
  {
    key: 'ai-trading-bot-scams',
    title: 'AI Trading Bot Scams',
    section: 'core',
    cluster_numbers: [3],
    hub_match: (p) =>
      p.cluster_number === 3 && /\/scams\/ai-trading-bots\/?$/.test(p.url_path || ''),
    children: [
      {
        kind: 'pages',
        title: 'AI Trading Bot Scams',
        // Hub excluded in buildBranchFromDef when kind === 'pages'
        filter: (p) => p.cluster_number === 3,
      },
    ],
  },
  {
    key: 'verification-tools',
    title: 'Verification & Tools',
    section: 'core',
    cluster_numbers: [4],
    hub_match: (p) => p.cluster_number === 4 && /\/check\//.test(p.url_path || ''),
    children: [
      {
        kind: 'pages',
        title: 'Verification & Tools',
        filter: (p) => p.cluster_number === 4,
      },
    ],
  },
  {
    key: 'victim-journey',
    title: 'Victim Journey',
    section: 'core',
    cluster_numbers: [5],
    children: [
      {
        kind: 'recover',
        title: 'Recover',
        filter: (p) => p.cluster_number === 5 && /recover/i.test(p.cluster_label || ''),
      },
      {
        kind: 'report',
        title: 'Report',
        filter: (p) => p.cluster_number === 5 && /report/i.test(p.cluster_label || ''),
      },
    ],
  },
]

const OUTER_PILLAR_DEFS = [
  {
    key: 'scam-alerts',
    title: 'Scam Alerts (Trending)',
    section: 'outer',
    cluster_numbers: [6],
    // Prefer a real hub page; rolling placeholder also uses /alerts/ but must not become the pillar title
    hub_match: (p) =>
      p.cluster_number === 6 &&
      !p.rolling_placeholder &&
      /\/alerts\/\s*$/.test(p.url_path || ''),
    children: [
      {
        kind: 'pages',
        title: 'Scam Alerts',
        filter: (p) => p.cluster_number === 6 && !p.rolling_placeholder,
      },
    ],
  },
  {
    key: 'safe-crypto-education',
    title: 'Safe Crypto Education',
    section: 'outer',
    cluster_numbers: [7],
    children: [{ kind: 'pages', title: 'Safe Crypto Education', filter: (p) => p.cluster_number === 7 }],
  },
  {
    key: 'exchange-safety',
    title: 'Exchange Safety Reports',
    section: 'outer',
    cluster_numbers: [8],
    children: [{ kind: 'pages', title: 'Exchange Safety Reports', filter: (p) => p.cluster_number === 8 }],
  },
  {
    key: 'data-link-magnets',
    title: 'Data & Link Magnets',
    section: 'outer',
    cluster_numbers: [9],
    children: [{ kind: 'pages', title: 'Data & Link Magnets', filter: (p) => p.cluster_number === 9 }],
  },
]

function avgWave(pages) {
  if (!pages.length) return 2
  const sum = pages.reduce((s, p) => s + (p.publication_wave || 2), 0)
  return Math.min(3, Math.max(1, Math.round(sum / pages.length)))
}

function pickHub(pages, hubMatch) {
  if (!hubMatch) return null
  return pages.find((p) => !p.rolling_placeholder && hubMatch(p)) || null
}

function makePillarNode(def, pages, hub, { synthetic = false } = {}) {
  const section = def.section
  const wave = hub?.publication_wave ?? avgWave(pages.filter((p) => (def.cluster_numbers || []).includes(p.cluster_number)))
  const title = hub?.title || def.title
  const urlPath = hub?.url_path || def.url_path || `/${slugify(def.title)}/`
  const targetKeyword = hub?.target_keyword || def.target_keyword || null
  const secondary = hub?.secondary_keywords || []
  const volume = hub?.search_volume ?? Math.max(0, ...pages.map((p) => p.search_volume || 0))
  const kd = hub?.keyword_difficulty ?? 0
  // Structural Koray hubs (Victim Journey, folder titles, alerts borrowed from
  // rolling placeholder) are not sheet pages — stamp so Write stays gated.
  const isSynthetic = synthetic || !hub || hub.rolling_placeholder === true

  const fields = buildTopicFields(
    {
      title,
      url_path: urlPath,
      slug: slugify(def.key || title),
      target_keyword: targetKeyword,
      secondary_keywords: secondary,
      search_volume: volume,
      keyword_difficulty: kd,
      search_intent: hub?.search_intent || 'informational',
      publication_wave: Math.min(wave, 2),
      notes: hub?.notes || null,
      keyword_data_source: hub?.keyword_data_source || 'unverified',
      metric_provenance: hub?.metric_provenance,
      cluster_key: def.key,
      content_type: 'pillar_page',
      node_type: section === 'outer' && /alert|trending/i.test(def.title) ? 'trending' : 'quality',
      qa_flags: isSynthetic
        ? [{ type: 'synthetic_hub', detail: 'Koray structural pillar; not a sheet keyword page' }]
        : [],
    },
    { topicType: 'pillar', section, sortOrder: 0, clusterLabel: def.title }
  )

  return fields
}

function makeClusterNode(title, section, pages, sortOrder, pillarSlug) {
  const wave = avgWave(pages)
  return buildTopicFields(
    {
      title,
      slug: slugify(title),
      url_path: null,
      target_keyword: null,
      secondary_keywords: [],
      search_volume: 0,
      keyword_difficulty: 0,
      search_intent: 'informational',
      publication_wave: wave,
      notes: null,
      keyword_data_source: 'unverified',
      cluster_key: slugify(title),
      content_type: 'educational',
    },
    {
      topicType: 'cluster',
      section,
      sortOrder,
      ancestorSlugs: [pillarSlug],
      clusterLabel: title,
    }
  )
}

function makeSupportingNode(page, section, sortOrder, ancestorSlugs, clusterLabel) {
  const fields = buildTopicFields(
    {
      ...page,
      slug: page.slug,
      url_path: page.url_path,
      internal_links_to: page.internal_links_raw || [],
    },
    {
      topicType: 'supporting',
      section,
      sortOrder,
      ancestorSlugs,
      clusterLabel,
    }
  )
  // Prefer the sheet's Suggested URL when present
  if (page.url_path) fields.url_path = page.url_path
  return fields
}

function resolveInternalLinks(structure) {
  const byTitle = new Map()
  const bySlug = new Map()
  const byUrl = new Map()

  const visit = (node) => {
    byTitle.set(String(node.title || '').toLowerCase(), node.slug)
    bySlug.set(node.slug, node.slug)
    if (node.url_path) byUrl.set(cleanUrlPath(node.url_path), node.slug)
  }

  for (const branch of structure.pillars) {
    visit(branch.pillar)
    for (const c of branch.clusters || []) {
      visit(c)
      for (const s of c.supporting || []) visit(s)
    }
  }

  const resolveOne = (raw) => {
    const t = String(raw || '').trim()
    if (!t) return null
    if (bySlug.has(t)) return t
    const url = cleanUrlPath(t)
    if (url && byUrl.has(url)) return byUrl.get(url)
    const lower = t.toLowerCase()
    if (byTitle.has(lower)) return byTitle.get(lower)
    // Fuzzy: contains title
    for (const [title, slug] of byTitle) {
      if (title.includes(lower) || lower.includes(title)) return slug
    }
    return null
  }

  const patch = (node) => {
    const raw = node.internal_links_to || []
    const resolved = []
    for (const r of raw) {
      const slug = resolveOne(r)
      if (slug && slug !== node.slug) resolved.push(slug)
    }
    node.internal_links_to = [...new Set(resolved)]
  }

  for (const branch of structure.pillars) {
    patch(branch.pillar)
    for (const c of branch.clusters || []) {
      patch(c)
      for (const s of c.supporting || []) patch(s)
    }
  }
}

function recomputePriorityWithinWaves(structure) {
  const leaves = []
  for (const branch of structure.pillars) {
    for (const c of branch.clusters || []) {
      for (const s of c.supporting || []) leaves.push(s)
    }
  }
  for (const s of leaves) {
    s.priority_score = computeTopicPriorityScore({
      search_volume: s.search_volume,
      keyword_difficulty: s.keyword_difficulty,
      business_value: s.business_value,
    })
  }
}

/**
 * Detect whether the Growth Partner numbered-cluster shape is present.
 */
function isGrowthPartnerShape(pages) {
  const nums = new Set(pages.map((p) => p.cluster_number).filter((n) => n != null))
  return nums.has(1) && nums.has(2) && (nums.has(5) || nums.has(3))
}

function buildBranchFromDef(def, pages, warnings) {
  const section = def.section
  const relevant = pages.filter((p) => (def.cluster_numbers || []).includes(p.cluster_number))
  if (!relevant.length) return null

  const hub = pickHub(relevant, def.hub_match)
  // Alerts sheet puts /alerts/ on the rolling placeholder row — borrow URL, keep def title
  let pillarHub = hub
  if (def.key === 'scam-alerts' && !hub) {
    const rollingHub = relevant.find(
      (p) => p.rolling_placeholder && /\/alerts\/\s*$/.test(p.url_path || '')
    )
    if (rollingHub) {
      pillarHub = {
        ...rollingHub,
        title: def.title,
        target_keyword: def.target_keyword || 'scam alerts',
        notes: null,
      }
    }
  }
  const pillar = makePillarNode(def, relevant, pillarHub)
  const clusters = []
  let ci = 0

  // Alerts: capture rolling note on pillar once (never a leaf)
  if (def.key === 'scam-alerts') {
    const rolling = pages.filter((p) => p.cluster_number === 6 && p.rolling_placeholder)
    if (rolling.length) {
      const note = rolling.map((r) => r.title || r.notes).filter(Boolean).join('; ')
      pillar.notes = [pillar.notes, `Rolling cadence: ${note}`].filter(Boolean).join(' | ')
      warnings.push('Scam Alerts rolling placeholder kept as pillar note (not a keyword page)')
    }
  }

  for (const child of def.children || []) {
    let kids = pages.filter(child.filter)
    // For verification tools, include hub in supporting list if it wasn't used as pillar-only
    if (child.kind === 'pages' && hub) {
      kids = kids.filter((p) => p !== hub)
    }
    // For spokes under crypto scams, exclude hub
    if (child.kind === 'spokes' && hub) {
      kids = kids.filter((p) => p !== hub)
    }

    if (!kids.length && child.kind !== 'wiki' && child.kind !== 'recover' && child.kind !== 'report') {
      continue
    }
    // Always create recover/report/wiki clusters when filter matches the definition intent
    if (!kids.length) continue

    const cluster = makeClusterNode(child.title, section, kids, ci++, pillar.slug)
    // Prefer hub URL as parent path hint for supporting url_path already set from sheet
    cluster.supporting = kids.map((p, si) =>
      makeSupportingNode(p, section, si, [pillar.slug, cluster.slug], child.title)
    )
    clusters.push(cluster)
  }

  // If no clusters produced but we have non-hub pages, create one synthetic cluster
  if (!clusters.length) {
    const leftovers = relevant.filter((p) => p !== hub)
    if (leftovers.length) {
      const cluster = makeClusterNode(def.title, section, leftovers, 0, pillar.slug)
      cluster.supporting = leftovers.map((p, si) =>
        makeSupportingNode(p, section, si, [pillar.slug, cluster.slug], def.title)
      )
      clusters.push(cluster)
    }
  }

  return {
    section,
    node_type: pillar.node_type,
    pillar,
    clusters,
  }
}

/**
 * Generic fallback: each numbered cluster → pillar with one synthetic child cluster.
 */
function buildFallbackStructure(pages, warnings) {
  warnings.push('Using generic fallback consolidator (cluster names did not match Growth Partner shape)')
  const byNum = new Map()
  for (const p of pages) {
    const key = p.cluster_number != null ? String(p.cluster_number) : p.cluster_label
    if (!byNum.has(key)) byNum.set(key, [])
    byNum.get(key).push(p)
  }

  const pillars = []
  let pi = 0
  for (const [, group] of byNum) {
    const section = group[0]?.section || 'core'
    const label = group[0]?.cluster_label || `Cluster ${pi + 1}`
    const shallow = group.find((p) => {
      const depth = (p.url_path || '').split('/').filter(Boolean).length
      return depth <= 1
    })
    const def = {
      key: slugify(label),
      title: label,
      section,
      cluster_numbers: [group[0]?.cluster_number],
      hub_match: shallow ? (p) => p === shallow : null,
      children: [{ kind: 'pages', title: label, filter: (p) => group.includes(p) }],
    }
    // Manual build for fallback
    const hub = shallow || null
    const pillar = makePillarNode({ ...def, title: hub?.title || label }, group, hub)
    pillar.sort_order = pi++
    const kids = group.filter((p) => p !== hub)
    const cluster = makeClusterNode(label, section, kids.length ? kids : group, 0, pillar.slug)
    cluster.supporting = (kids.length ? kids : group.filter((p) => p !== hub)).map((p, si) =>
      makeSupportingNode(p, section, si, [pillar.slug, cluster.slug], label)
    )
    if (!cluster.supporting.length && hub) {
      // Only hub existed — still keep empty cluster? Prefer attach hub as supporting only when no kids
      cluster.supporting = []
    }
    pillars.push({ section, node_type: pillar.node_type, pillar, clusters: [cluster] })
  }
  return { pillars }
}

/**
 * Build Koray-consolidated structure from normalized page rows.
 * Returns { structure, warnings, counts }.
 */
function consolidateKoray(pages) {
  const warnings = []
  const usable = (pages || []).filter((p) => !p.rolling_placeholder || p.cluster_number !== 6)
  // Keep rolling pages in source for notes, but exclude from leaf count via filter in alerts def

  let structure
  if (isGrowthPartnerShape(pages)) {
    const pillars = []
    for (const def of [...CORE_PILLAR_DEFS, ...OUTER_PILLAR_DEFS]) {
      const branch = buildBranchFromDef(def, pages, warnings)
      if (branch) pillars.push(branch)
    }
    structure = { pillars }
  } else {
    structure = buildFallbackStructure(usable.length ? usable : pages, warnings)
  }

  // Assign sort_order on pillars
  structure.pillars.forEach((b, i) => {
    b.pillar.sort_order = i
  })

  resolveInternalLinks(structure)
  recomputePriorityWithinWaves(structure)

  // Guard: section must never flip page_role
  for (const branch of structure.pillars) {
    if (branch.pillar.page_role !== 'Root') {
      warnings.push(`Pillar page_role corrected for ${branch.pillar.title}`)
      branch.pillar.page_role = 'Root'
    }
    for (const c of branch.clusters || []) {
      c.page_role = 'Core'
      for (const s of c.supporting || []) {
        s.page_role = 'Outer'
        // Section comes from sheet; page_role from depth only — assert independence
        if (s.section !== branch.section) {
          // supporting inherits branch section for tree consistency when sheet mismatch
          s.section = branch.section
        }
      }
      c.section = branch.section
    }
    branch.pillar.section = branch.section
  }

  const counts = {
    pillars: structure.pillars.length,
    clusters: structure.pillars.reduce((n, b) => n + (b.clusters?.length || 0), 0),
    supporting: structure.pillars.reduce(
      (n, b) => n + (b.clusters || []).reduce((m, c) => m + (c.supporting?.length || 0), 0),
      0
    ),
  }

  return { structure, warnings, counts }
}

/**
 * Whether a pre-consolidate page row matches a Growth Partner pillar hub URL.
 */
function isPillarHubPage(page) {
  for (const def of [...CORE_PILLAR_DEFS, ...OUTER_PILLAR_DEFS]) {
    if (def.hub_match?.(page)) return true
  }
  return false
}

module.exports = {
  consolidateKoray,
  isGrowthPartnerShape,
  isPillarHubPage,
  CORE_PILLAR_DEFS,
  OUTER_PILLAR_DEFS,
}
