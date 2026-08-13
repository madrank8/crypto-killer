'use strict'

// YAML serializer for the 12-section content brief.
//
// This is the handoff format: seo-blog-generator parses SPECIFIC field names at its
// Step 1, so field names and section order are fixed by
// `content-brief-generator/references/brief-template.md`. Object key order is not
// reliable, so the layout below is explicit.
//
// The single most important correctness detail: every honesty placeholder starts
// with `[` ("[NO DATA — …]", "[UNVERIFIED — …]"). Bare in YAML that parses as a
// flow SEQUENCE, so an unquoted placeholder would either explode into a list or
// fail to parse — silently destroying exactly the markers that carry the honesty
// signal. Everything ambiguous is quoted.
//
// Internal bookkeeping keys (`_seed_source`, `_mandatory`) are stripped at export;
// they are provenance for our UI, not part of the downstream contract.

// Ordered layout mirroring brief-template.md.
const SECTIONS = Object.freeze([
  { title: 'SECTION 1: IDENTITY', fields: ['brief_id', 'created', 'site_url', 'target_url', 'status'] },
  {
    title: 'SECTION 2: TOPICAL MAP PLACEMENT',
    fields: ['section', 'subsection', 'priority', 'node_type', 'fan_out_tag', 'publication_phase', 'publication_order'],
  },
  {
    title: 'SECTION 3: CONTENT METADATA',
    fields: ['title_tag', 'url_slug', 'meta_description', 'primary_keyword', 'secondary_keywords',
      'search_intent', 'ymyl', 'word_count_target', 'reading_time_estimate', 'schema_type', 'content_format',
      'locale', 'orthography_notes'],
  },
  {
    title: 'SECTION 3.5: NON-COMMODITY CLASSIFICATION (SC-098 Sullivan Test)',
    fields: ['content_type', 'forcing_inputs'],
  },
  {
    title: 'SECTION 4: E-E-A-T REQUIREMENTS',
    fields: ['author_required', 'reviewer_required', 'ymyl_level', 'experience_angle', 'expertise_signals', 'safe_answer_required'],
  },
  {
    title: 'SECTION 5: ENTITY CONTEXT',
    fields: ['central_entity', 'entity_wikidata', 'entity_schema_same_as', 'key_entities', 'related_entities', 'ngram_relations', 'predicates'],
  },
  {
    title: 'SECTION 6: HEADING SKELETON',
    fields: ['h1', 'h1_coverage_manifest', 'bluf_target', 'heading_seed_provenance', 'heading_structure', 'faq_sweep'],
  },
  { title: 'SECTION 7: CLAIM CATEGORIES (SOURCE LEDGER SEEDS)', fields: ['claim_categories'] },
  {
    title: 'SECTION 8: PASSAGE INDEPENDENCE',
    fields: ['passage_independence', 'passage_independence_reason', 'gen_intent', 'gen_intent_signal', 'key_claim_passages'],
  },
  { title: 'SECTION 9: INTERNAL LINKING', fields: ['internal_link_targets', 'outbound_link_targets'] },
  { title: 'SECTION 10: VISUAL REQUIREMENTS', fields: ['visual_assets'] },
  { title: 'SECTION 11: COMPETITOR BENCHMARKS', fields: ['competitor_pages_to_beat', 'competitor_gap_insight', 'competitor_benchmarks'] },
  {
    title: 'SECTION 12: PUBLICATION & COMPLIANCE METADATA',
    fields: ['dependencies', 'review_required', 'compliance_notes', 'llms_txt_tier', 'seo_blog_generator_version', 'topical_map_version'],
  },
])

const IND = '  '
const pad = (n) => IND.repeat(n)

// Any string a YAML parser could resolve to a NON-string gets quoted. Getting this
// wrong silently changes a value's type on the way to the writing pipeline — on a
// crypto site a bare wallet address like `0x1234abcd` would come back as a number.
const NUMERIC_LIKE = [
  /^[+-]?[\d_]+$/,                                  // int, incl. leading + and 1_000
  /^[+-]?[\d_]*\.[\d_]*$/,                           // float, incl. `.5` and `5.`
  /^[+-]?[\d_]*\.?[\d_]+[eE][+-]?\d+$/,              // scientific notation
  /^[+-]?0[xX][0-9a-fA-F_]+$/,                      // hex — wallet addresses, tx hashes
  /^[+-]?0[oO][0-7_]+$/,                            // octal
  /^[+-]?0[bB][01_]+$/,                             // binary
  /^[+-]?\.(inf|Inf|INF)$/, /^\.(nan|NaN|NAN)$/,     // infinity / NaN
  /^[+-]?\d+(:[0-5]?\d)+$/,                          // YAML 1.1 sexagesimal (1:30)
]

function needsQuote(s) {
  if (s === '') return true
  if (/^[\[\]{}>|*&!%#@`,?:'"-]/.test(s)) return true
  if (/:\s/.test(s) || /\s#/.test(s)) return true
  if (/^(true|false|null|yes|no|on|off|y|n|~)$/i.test(s)) return true
  if (NUMERIC_LIKE.some((re) => re.test(s))) return true
  if (/^\s|\s$/.test(s)) return true
  if (/^(---|\.\.\.)/.test(s)) return true          // document markers
  if (/[\t\r]/.test(s)) return true                 // tabs/CR are not safe bare
  return false
}

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// Long or multiline prose uses a folded block scalar, matching the template's style
// and keeping lines readable.
function blockScalar(str, depth) {
  const body = String(str).split(/\r?\n/).map((line) => `${pad(depth + 1)}${line}`.trimEnd()).join('\n')
  return `>-\n${body}`
}

function scalar(value, depth) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const s = String(value)
  if (s.includes('\n')) return blockScalar(s, depth)
  if (s.length > 110) return blockScalar(s, depth)
  return needsQuote(s) ? quote(s) : s
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const publicKeys = (obj) => Object.keys(obj).filter((k) => !k.startsWith('_'))

function emitEntry(key, value, depth, lines) {
  const indent = pad(depth)

  if (Array.isArray(value)) {
    // An array whose items are ALL unemittable (e.g. every item is `{}` or has only
    // internal keys) must still emit `[]`. Skipping them all would leave a bare
    // `key:` which parses back as null — an array field silently becoming null.
    const emittable = value.filter((item) => !isPlainObject(item) || publicKeys(item).length > 0)
    if (emittable.length === 0) { lines.push(`${indent}${key}: []`); return }
    lines.push(`${indent}${key}:`)
    for (const item of emittable) {
      if (isPlainObject(item)) {
        const keys = publicKeys(item)
        lines.push(`${indent}${IND}- ${keys[0]}: ${scalar(item[keys[0]], depth + 2)}`)
        for (const k of keys.slice(1)) {
          if (Array.isArray(item[k]) || isPlainObject(item[k])) emitEntry(k, item[k], depth + 2, lines)
          else lines.push(`${pad(depth + 2)}${k}: ${scalar(item[k], depth + 2)}`)
        }
      } else {
        lines.push(`${indent}${IND}- ${scalar(item, depth + 1)}`)
      }
    }
    return
  }

  if (isPlainObject(value)) {
    const keys = publicKeys(value)
    if (keys.length === 0) { lines.push(`${indent}${key}: {}`); return }
    lines.push(`${indent}${key}:`)
    for (const k of keys) emitEntry(k, value[k], depth + 1, lines)
    return
  }

  lines.push(`${indent}${key}: ${scalar(value, depth)}`)
}

/**
 * Serialize a brief to the canonical YAML handoff format.
 * Fields absent from the brief are skipped rather than emitted as null noise.
 */
function toYaml(brief) {
  const b = brief && typeof brief === 'object' ? brief : {}
  const lines = [
    '# ─────────────────────────────────────────────────────────────',
    '# CONTENT BRIEF',
    '# Generated by: crypto-killer admin (content-brief-generator v1.6 port)',
    '# Conformance: draft is diffed against this brief at seo-blog-generator Step 6.7b',
    '#   (brief-fidelity-gate) when that gate is wired. Deviations must be fixed or',
    '#   formally supersede the brief.',
    '# Pipeline: topical-map-creation → content-brief-generator → seo-blog-generator',
    '#',
    '# Bracketed values are HONESTY MARKERS, not placeholders to fill in casually:',
    '#   [NO DATA …]     tool data was not available',
    '#   [UNVERIFIED …]  a source must be located and verified by an editor',
    '#   [UNRESOLVED …]  an identifier could not be verified',
    '#   [PENDING …]     LLM enrichment has not run for this field',
    '# ─────────────────────────────────────────────────────────────',
  ]

  for (const section of SECTIONS) {
    const present = section.fields.filter((f) => b[f] !== undefined)
    if (present.length === 0) continue
    lines.push('')
    lines.push(`# ── ${section.title} ${'─'.repeat(Math.max(0, 58 - section.title.length))}`)
    for (const field of present) emitEntry(field, b[field], 0, lines)
  }

  return `${lines.join('\n')}\n`
}

module.exports = { SECTIONS, toYaml, needsQuote }
