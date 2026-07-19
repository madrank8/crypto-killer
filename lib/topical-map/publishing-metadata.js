'use strict'

// Tier 2 Publishing Metadata (topical-map-creation v4.6, Steps 15–19 + v4.1
// "Content Format"). Only the fields that are pure, deterministic functions of
// data the pipeline already holds are produced here — Title Tag and Meta
// Description are creative copy and are generated in the writing-flow handoff,
// not fabricated by heuristic. Everything below is honesty-safe: no metric is
// invented, and each output is a mechanical transform of existing signals.

const { slugify } = require('./text-utils')

// ── Step 16: hierarchical URL path, no word repetition ──────────────────────
// segments = ancestor→leaf slug/text array (e.g. ['casino-reviews',
// 'stake-us-casino-review']). Each segment keeps only the words not already
// present in the accumulated ancestor path, so:
//   ['casino-reviews', 'stake-us-casino-review'] -> '/casino-reviews/stake-us/'
// A segment emptied by dedup is dropped. Returns a single leading+trailing slash.
// Light stem so dedup is plural-insensitive ("review" collides with "reviews").
// Short words (≤3 chars) are left exact so "us"/"vs" are never mangled.
function stem(word) {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

function buildUrlPath(segments) {
  const list = Array.isArray(segments) ? segments : []
  const seen = new Set() // stems already used by an ancestor segment
  const parts = []
  for (const raw of list) {
    if (!String(raw ?? '').trim()) continue // skip before slugify's 'topic' fallback fires
    const s = slugify(raw)
    const kept = []
    for (const word of s.split('-')) {
      if (!word) continue
      const key = stem(word)
      if (seen.has(key)) continue
      seen.add(key)
      kept.push(word) // keep the original surface word, dedup on the stem
    }
    if (kept.length) parts.push(kept.join('-'))
  }
  return `/${parts.join('/')}${parts.length ? '/' : ''}`
}

// ── Step 19b: Content Format (10-format taxonomy) ───────────────────────────
// Human-readable production template that feeds the writing pipeline. Distinct
// from the terse `format_code`. Domain-inapplicable medical formats (Clinical
// Evidence Review, Symptom Checklist) are intentionally excluded.
const CONTENT_FORMATS = Object.freeze([
  'Evergreen Article',
  'Comparison Table',
  'Step-by-step Guide',
  'FAQ Hub',
  'Listicle',
  'Calculator / Interactive Tool',
  'Case Study / Data Report',
  'Landing Page (Commercial)',
  'News / Update',
])

// format_code (LLM-assigned, domain-produced) is the primary signal. When it is
// missing/unknown, fall back to intent/node_type per the skill's assignment rules.
const FORMAT_BY_CODE = Object.freeze({
  DEF: 'FAQ Hub',
  GLOSSARY: 'FAQ Hub',
  HOWTO: 'Step-by-step Guide',
  LIST: 'Listicle',
  COMP: 'Comparison Table',
  REVIEW: 'Evergreen Article', // investigative scam review, not a commercial LP
  GUIDE: 'Evergreen Article',
  NEWS: 'News / Update',
  TOOL: 'Calculator / Interactive Tool',
})

function classifyContentFormat({ format_code, search_intent, node_type, content_type } = {}) {
  const code = typeof format_code === 'string' ? format_code.toUpperCase().trim() : ''
  if (FORMAT_BY_CODE[code]) return FORMAT_BY_CODE[code]

  // Fallbacks when no explicit format_code (assignment rules 2–4).
  if (content_type === 'brand_review') return 'Evergreen Article'
  if (search_intent === 'commercial' || search_intent === 'transactional') return 'Landing Page (Commercial)'
  if (node_type === 'trending') return 'News / Update'
  // Quality nodes and everything else default to the in-depth explainer.
  return 'Evergreen Article'
}

// ── Schema.org type ─────────────────────────────────────────────────────────
const SCHEMA_TYPES = Object.freeze([
  'Article', 'FAQPage', 'HowTo', 'ItemList', 'Review', 'NewsArticle', 'WebApplication',
])

const SCHEMA_BY_CODE = Object.freeze({
  DEF: 'FAQPage',
  GLOSSARY: 'FAQPage',
  HOWTO: 'HowTo',
  LIST: 'ItemList',
  COMP: 'ItemList',
  REVIEW: 'Review',
  NEWS: 'NewsArticle',
  TOOL: 'WebApplication',
  GUIDE: 'Article',
})

function classifySchemaType({ content_type, format_code } = {}) {
  if (content_type === 'brand_review') return 'Review'
  const code = typeof format_code === 'string' ? format_code.toUpperCase().trim() : ''
  return SCHEMA_BY_CODE[code] || 'Article'
}

module.exports = {
  buildUrlPath,
  CONTENT_FORMATS,
  classifyContentFormat,
  SCHEMA_TYPES,
  classifySchemaType,
}
