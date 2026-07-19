'use strict'

// Content Brief — the Tier 3 handoff from the topical map to the writing flow
// (content-brief-generator "From Map" mode). A pure projection of a topic row
// into an outline-ready brief: it turns the map's production metadata
// (content_format, schema_type, node_function, url_path, paa_questions, aio_risk,
// …) into explicit directives the outline generator can act on.
//
// HONESTY: this fabricates nothing. Every field is copied straight from the
// topic row; a field with no real value is OMITTED from the brief (and from the
// rendered prompt block), never invented or defaulted to a fake directive.

function nonEmpty(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

// Coerce a value that SHOULD be a string array (jsonb columns like
// secondary_keywords / paa_questions / internal_links_to) into a clean array of
// non-blank strings, or null if it is not a usable array. This both prevents a
// `.join` crash when the column holds a bare string/garbage and drops blank
// entries so the rendered directive never shows "kw, , kw".
function cleanStrArray(v) {
  if (!Array.isArray(v)) return null
  const out = v
    .filter((x) => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim())
  return out.length ? out : null
}

// aio_risk (0–100 or a label) → how hard the writer should optimize each section
// for extractability. Only produced when a real risk value is present.
function aioRiskDirective(aio_risk) {
  if (!nonEmpty(aio_risk)) return null
  const n = typeof aio_risk === 'number' ? aio_risk : Number(aio_risk)
  const level = Number.isFinite(n)
    ? (n >= 66 ? 'high' : n >= 33 ? 'medium' : 'low')
    : String(aio_risk).toLowerCase()
  if (level === 'high') return `AIO risk high (${aio_risk}) — open every H2 with a 40–60 word directly-extractable answer, then expand. Add an FAQ block mirroring the People-Also-Ask questions.`
  if (level === 'medium') return `AIO risk medium (${aio_risk}) — lead key H2s with a concise extractable answer before elaborating.`
  if (level === 'low') return `AIO risk low (${aio_risk}) — standard depth; extractable answers optional.`
  return `AIO risk: ${aio_risk}.`
}

function buildContentBrief(topic, { parentTopic } = {}) {
  const t = topic && typeof topic === 'object' ? topic : {}
  const brief = {}

  // ── Identity ──────────────────────────────────────────────────────────────
  const identity = {}
  if (nonEmpty(t.title)) identity.raw_topic = t.title
  if (nonEmpty(t.target_keyword)) identity.primary_keyword = t.target_keyword
  if (nonEmpty(t.url_path)) identity.url_path = t.url_path
  else if (nonEmpty(t.slug)) identity.slug = t.slug
  if (Object.keys(identity).length) brief.identity = identity

  // ── Map placement ─────────────────────────────────────────────────────────
  const placement = {}
  if (nonEmpty(t.topic_type)) placement.topic_type = t.topic_type
  if (nonEmpty(t.section)) placement.section = t.section
  if (nonEmpty(t.page_role)) placement.page_role = t.page_role
  if (nonEmpty(t.node_type)) placement.node_type = t.node_type
  if (nonEmpty(t.node_function)) placement.node_function = t.node_function
  if (parentTopic && nonEmpty(parentTopic.title)) placement.parent = parentTopic.title
  if (Object.keys(placement).length) brief.placement = placement

  // ── Keyword targeting ───────────────────────────────────────────────────────
  const targeting = {}
  if (nonEmpty(t.search_intent)) targeting.search_intent = t.search_intent
  const secondary = cleanStrArray(t.secondary_keywords)
  if (secondary) targeting.secondary_keywords = secondary
  if (nonEmpty(t.macro_vector)) targeting.macro_vector = t.macro_vector
  if (Object.keys(targeting).length) brief.targeting = targeting

  // ── Production format ───────────────────────────────────────────────────────
  const production = {}
  if (nonEmpty(t.content_format)) production.content_format = t.content_format
  if (nonEmpty(t.format_code)) production.format_code = t.format_code
  if (nonEmpty(t.schema_type)) production.schema_type = t.schema_type
  if (Object.keys(production).length) brief.production = production

  // ── Heading seeds (People-Also-Ask → mandatory H2 coverage) ─────────────────
  const paa = cleanStrArray(t.paa_questions)
  if (paa) brief.heading_seeds = paa

  // ── AIO extractability directive ────────────────────────────────────────────
  const aio = aioRiskDirective(t.aio_risk)
  if (aio) brief.aio_directive = aio

  // ── Internal links ──────────────────────────────────────────────────────────
  const links = cleanStrArray(t.internal_links_to)
  if (links) brief.internal_link_targets = links

  // ── Priority ────────────────────────────────────────────────────────────────
  if (nonEmpty(t.priority_score)) brief.priority_score = t.priority_score

  return brief
}

// Render the brief as a compact directive block for injection into the outline
// prompt. Returns '' when the brief is empty, so callers can drop it cleanly.
function formatBriefForPrompt(topic, opts = {}) {
  const b = buildContentBrief(topic, opts)
  const lines = []

  if (b.production) {
    if (b.production.content_format) lines.push(`- TARGET FORMAT: ${b.production.content_format}${b.production.format_code ? ` (${b.production.format_code})` : ''}`)
    if (b.production.schema_type) lines.push(`- SCHEMA TARGET: ${b.production.schema_type} — structure the page so this schema maps cleanly.`)
  }
  if (b.placement) {
    const p = b.placement
    const bits = []
    if (p.node_function) bits.push(`function=${p.node_function}`)
    if (p.node_type) bits.push(`node=${p.node_type}`)
    if (p.page_role) bits.push(`role=${p.page_role}`)
    if (p.section) bits.push(`section=${p.section}`)
    if (bits.length) lines.push(`- MAP PLACEMENT: ${bits.join(', ')}${p.parent ? ` (under "${p.parent}")` : ''}`)
  }
  if (b.targeting?.search_intent) lines.push(`- SEARCH INTENT: ${b.targeting.search_intent} — match the page's dominant intent.`)
  if (b.targeting?.secondary_keywords) lines.push(`- SECONDARY KEYWORDS (weave naturally, no stuffing): ${b.targeting.secondary_keywords.join(', ')}`)
  if (b.heading_seeds) lines.push(`- MUST COVER — People-Also-Ask (seed an H2 or FAQ item for each): ${b.heading_seeds.join(' | ')}`)
  if (b.aio_directive) lines.push(`- ${b.aio_directive}`)
  if (b.identity?.url_path) lines.push(`- CANONICAL URL PATH: ${b.identity.url_path}`)

  if (!lines.length) return ''
  return `═══ TOPICAL MAP BRIEF (from the map; honor these production directives) ═══\n${lines.join('\n')}`
}

module.exports = { buildContentBrief, formatBriefForPrompt }
