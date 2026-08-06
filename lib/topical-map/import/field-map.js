'use strict'

const { computeTopicPriorityScore } = require('../../content-prompts')
const { classifyNodeFunction } = require('../node-function')
const { classifyContentFormat, classifySchemaType } = require('../publishing-metadata')
const { keywordMetricProvenance } = require('../provenance')
const { slugify } = require('../text-utils')

/** Required headers for the page-map tab (Growth Partner sheet shape). */
const PAGE_MAP_HEADERS = Object.freeze([
  'Section',
  'Cluster',
  'Page Title (Title Tag Style)',
  'Suggested URL',
  'Primary Query Cluster',
  'Lead KW Volume',
  'KD',
  'Search Intent',
  'Internal Links To',
  'Notes / Angle',
  'Phase',
])

const HEADER_ALIASES = Object.freeze({
  section: 'Section',
  cluster: 'Cluster',
  'page title (title tag style)': 'Page Title (Title Tag Style)',
  'page title': 'Page Title (Title Tag Style)',
  title: 'Page Title (Title Tag Style)',
  'suggested url': 'Suggested URL',
  url: 'Suggested URL',
  'primary query cluster': 'Primary Query Cluster',
  'lead kw volume': 'Lead KW Volume',
  volume: 'Lead KW Volume',
  kd: 'KD',
  'search intent': 'Search Intent',
  intent: 'Search Intent',
  'internal links to': 'Internal Links To',
  'notes / angle': 'Notes / Angle',
  notes: 'Notes / Angle',
  phase: 'Phase',
})

function normalizeHeader(h) {
  return String(h || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
}

function remapRowKeys(row) {
  const out = {}
  for (const [k, v] of Object.entries(row || {})) {
    const canon = HEADER_ALIASES[normalizeHeader(k)] || k
    out[canon] = v
  }
  return out
}

function looksLikePageMapHeaders(headers) {
  const set = new Set((headers || []).map(normalizeHeader))
  const need = ['section', 'cluster', 'suggested url', 'phase']
  const titleOk = set.has('page title (title tag style)') || set.has('page title') || set.has('title')
  return titleOk && need.every((h) => set.has(h))
}

function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function normalizeSection(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'core' || s === 'outer') return s
  return s.includes('outer') ? 'outer' : 'core'
}

function normalizeIntent(raw) {
  const s = String(raw || '').toLowerCase()
  if (s.includes('transaction')) return 'transactional'
  if (s.includes('commercial')) return 'commercial'
  if (s.includes('navigat')) return 'navigational'
  if (s.includes('generat')) return 'generative'
  return 'informational'
}

/**
 * Split Primary Query Cluster into keywords on `;` / `|`.
 * Parenthetical notes (e.g. "kw (digital PR asset; journalist queries)")
 * are stripped first so methodology asides never become fake keywords.
 */
function splitKeywords(raw) {
  const cleaned = String(raw || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned
    .split(/[;|]/)
    .map((k) => k.trim())
    .filter(Boolean)
}

/**
 * Derive a primary keyword from a title-tag style heading when the sheet
 * left Primary Query Cluster empty or paren-only notes.
 * Uses the phrase before the first subtitle colon.
 */
function keywordFromTitle(title) {
  const raw = String(title || '').trim()
  if (!raw) return null
  const head = raw.split(':')[0].trim()
  const cleaned = head
    .replace(/["“”']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return cleaned || null
}

function splitInternalLinks(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function cleanUrlPath(raw) {
  let u = String(raw || '').trim()
  if (!u) return null
  // Drop parenthetical notes: "/check/ (or homepage)"
  u = u.replace(/\s*\([^)]*\)\s*/g, '').trim()
  // Take first alternative if "a or b"
  if (/\bor\b/i.test(u)) {
    u = u.split(/\bor\b/i)[0].trim()
  }
  try {
    if (/^https?:\/\//i.test(u)) {
      const parsed = new URL(u)
      u = parsed.pathname
    }
  } catch {
    /* keep raw */
  }
  if (!u.startsWith('/')) u = `/${u}`
  if (u.length > 1 && !u.endsWith('/')) u = `${u}/`
  return u
}

function leafSlugFromUrl(urlPath, title) {
  const path = cleanUrlPath(urlPath)
  if (path && path !== '/') {
    const parts = path.split('/').filter(Boolean)
    if (parts.length) return slugify(parts[parts.length - 1])
  }
  return slugify(title)
}

function parseClusterMeta(clusterRaw) {
  const raw = String(clusterRaw || '').trim()
  const m = raw.match(/^(\d+)\.\s*(.+)$/)
  if (m) {
    return { number: Number(m[1]), label: m[2].trim(), raw }
  }
  return { number: null, label: raw || 'Untitled cluster', raw }
}

function isRollingPlaceholder(row) {
  const title = String(row['Page Title (Title Tag Style)'] || '')
  const notes = String(row['Notes / Angle'] || '')
  const url = String(row['Suggested URL'] || '')
  return (
    /ongoing|2-4 new scam alerts|rolling/i.test(title) ||
    /ongoing|rolling template/i.test(notes) ||
    (/\/alerts\/\s*$/.test(url) && !row['Lead KW Volume'] && /ongoing/i.test(title))
  )
}

/** Any non-blank page-map cell means the row is not spreadsheet padding. */
const PAGE_MAP_SIGNAL_HEADERS = PAGE_MAP_HEADERS

function hasPageMapSignals(row) {
  return PAGE_MAP_SIGNAL_HEADERS.some((h) => String(row?.[h] ?? '').trim())
}

function isBlankPaddingRow(row) {
  return !hasPageMapSignals(row)
}

function inferContentType({ title, urlPath, intent, topicType }) {
  const t = `${title} ${urlPath}`.toLowerCase()
  if (topicType === 'pillar') return 'pillar_page'
  if (/\/review\//.test(urlPath || '') || /\breview\b/.test(t)) return 'brand_review'
  if (/checklist|how to|step-by-step|24 hours/.test(t)) return 'guide'
  if (/recover|get your money|scammed/.test(t)) return 'recovery_guide'
  if (/statistics|biggest|state of|list/.test(t)) return 'listicle'
  if (/safe|avoid|spot|warning|red flag/.test(t)) return 'prevention'
  if (intent === 'commercial' || intent === 'transactional') return 'comparison'
  return 'educational'
}

function inferContentRole({ topicType, intent, title, section }) {
  if (topicType === 'pillar') return 'pillar'
  const t = String(title || '').toLowerCase()
  if (/checker|verify|tool|lookup/.test(t)) return 'money'
  if (/methodology|statistics|report|ic3|lawyer/.test(t)) return 'trust'
  if (intent === 'transactional' || intent === 'commercial') return 'money'
  if (section === 'outer' && /alert|trending/.test(t)) return 'supporting'
  return 'supporting'
}

function inferNodeType({ topicType, section, clusterLabel, wave }) {
  if (topicType !== 'pillar') return 'standard'
  const label = String(clusterLabel || '').toLowerCase()
  if (/trending|alert/.test(label) || section === 'outer' && /alert/.test(label)) return 'trending'
  if (wave === 1 && section === 'core') return 'quality'
  if (/pillar|crypto scams|victim|verification|ai trading/.test(label)) return 'quality'
  return 'standard'
}

function businessValueFor({ contentRole, intent }) {
  if (contentRole === 'money') return 90
  if (contentRole === 'pillar') return 78
  if (contentRole === 'trust') return 58
  const INTENT_BV = {
    transactional: 90,
    commercial: 85,
    navigational: 40,
    informational: 60,
    generative: 55,
  }
  return INTENT_BV[intent] ?? 50
}

/**
 * Map one spreadsheet page row into a normalized page object (pre-tree).
 */
function mapPageRow(rawRow) {
  const row = remapRowKeys(rawRow)
  if (isBlankPaddingRow(row)) return null

  const title = String(row['Page Title (Title Tag Style)'] || '').trim()

  const urlPath = cleanUrlPath(row['Suggested URL'])
  let kws = splitKeywords(row['Primary Query Cluster'])
  if (!kws.length) {
    const fallback = keywordFromTitle(title)
    if (fallback) kws = [fallback]
  }
  const volume = parseNumber(row['Lead KW Volume'])
  const kd = parseNumber(row['KD'])
  const intent = normalizeIntent(row['Search Intent'])
  const section = normalizeSection(row['Section'])
  const phase = parseNumber(row['Phase']) || 3
  const cluster = parseClusterMeta(row['Cluster'])
  const rolling = isRollingPlaceholder(row)

  const hasMetrics = volume !== null || kd !== null
  const keywordDataSource = hasMetrics ? 'spreadsheet' : 'unverified'

  return {
    title,
    url_path: urlPath,
    slug: leafSlugFromUrl(urlPath, title),
    target_keyword: kws[0] || null,
    secondary_keywords: kws.slice(1),
    search_volume: volume ?? 0,
    keyword_difficulty: kd ?? 0,
    search_intent: intent,
    section,
    publication_wave: Math.min(3, Math.max(1, Math.round(phase))),
    notes: String(row['Notes / Angle'] || '').trim() || null,
    internal_links_raw: splitInternalLinks(row['Internal Links To']),
    cluster_number: cluster.number,
    cluster_label: cluster.label,
    cluster_raw: cluster.raw,
    keyword_data_source: keywordDataSource,
    metric_provenance: keywordMetricProvenance(keywordDataSource),
    rolling_placeholder: rolling,
    _sheet: row,
  }
}

/**
 * Build a persistable topic row from a structured node + hierarchy context.
 */
function buildTopicFields(node, { topicType, section, parentUrlPath, ancestorSlugs = [], sortOrder = 0, clusterLabel = null }) {
  const intent = node.search_intent || 'informational'
  const contentRole = inferContentRole({
    topicType,
    intent,
    title: node.title,
    section,
  })
  const wave = node.publication_wave ?? (topicType === 'pillar' ? 1 : 2)
  const nodeType = node.node_type || inferNodeType({ topicType, section, clusterLabel: clusterLabel || node.cluster_label, wave })
  const contentType = node.content_type || inferContentType({
    title: node.title,
    urlPath: node.url_path,
    intent,
    topicType,
  })
  const businessValue = node.business_value ?? businessValueFor({ contentRole, intent })
  const priority = computeTopicPriorityScore({
    search_volume: node.search_volume ?? 0,
    keyword_difficulty: node.keyword_difficulty ?? 0,
    business_value: businessValue,
  })

  const leafSlug = node.slug || slugify(node.title)
  const urlPath =
    node.url_path ||
    (topicType === 'cluster' && !node.url_path
      ? null
      : parentUrlPath
        ? null
        : `/${leafSlug}/`)

  return {
    topic_type: topicType,
    content_type: contentType,
    title: node.title,
    slug: leafSlug,
    description: node.description || node.notes || null,
    target_keyword: node.target_keyword || null,
    secondary_keywords: node.secondary_keywords || [],
    search_volume: node.search_volume ?? 0,
    keyword_difficulty: node.keyword_difficulty ?? 0,
    business_value: businessValue,
    priority_score: priority,
    content_status: 'planned',
    dependencies: [],
    internal_links_to: node.internal_links_to || node.internal_links_raw || [],
    sort_order: sortOrder,
    notes: node.notes || null,
    section,
    search_intent: intent,
    keyword_data_source: node.keyword_data_source || 'unverified',
    metric_provenance: node.metric_provenance || keywordMetricProvenance(node.keyword_data_source || 'unverified'),
    page_role: topicType === 'pillar' ? 'Root' : topicType === 'cluster' ? 'Core' : 'Outer',
    node_type: nodeType,
    node_function: classifyNodeFunction({
      content_type: contentType,
      content_role: contentRole,
      search_intent: intent,
      node_type: nodeType,
      topic_type: topicType,
    }),
    url_path: urlPath,
    content_format: classifyContentFormat({
      search_intent: intent,
      node_type: nodeType,
      content_type: contentType,
    }),
    schema_type: classifySchemaType({ content_type: contentType }),
    publication_wave: wave,
    content_role: contentRole,
    cluster_key: node.cluster_key || null,
    ancestor_slugs: [...ancestorSlugs, leafSlug],
  }
}

module.exports = {
  PAGE_MAP_HEADERS,
  PAGE_MAP_SIGNAL_HEADERS,
  looksLikePageMapHeaders,
  remapRowKeys,
  mapPageRow,
  hasPageMapSignals,
  isBlankPaddingRow,
  buildTopicFields,
  cleanUrlPath,
  splitKeywords,
  keywordFromTitle,
  parseClusterMeta,
  normalizeSection,
  normalizeIntent,
}
