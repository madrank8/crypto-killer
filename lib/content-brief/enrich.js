'use strict'

// LLM enrichment for the 12-section content brief.
//
// The model writes ONLY the creative sections. Everything measured, deterministic,
// or human-supplied is immutable to it. This module is the enforcement layer: the
// prompt asks nicely, `mergeEnrichment` guarantees. Anything the model returns for
// a protected field is discarded and reported in `rejected` — we never trust the
// prompt alone to hold an honesty rule.
//
// The specific failure this prevents: a fluent model "helpfully" replacing
// `[NO DATA — requires Tool-Assisted mode]` with a plausible competitor word count,
// or `[UNRESOLVED — verify at wikidata.org]` with a hallucinated Q-ID. Those read as
// facts downstream and are exactly the class of error this pipeline must not ship.

const { PLACEHOLDER } = require('./assemble')

// Fields the model MAY write.
const ENRICHABLE = Object.freeze([
  'title_tag', 'meta_description',
  'h1', 'h1_coverage_manifest', 'bluf_target',
  'key_entities', 'related_entities', 'ngram_relations', 'predicates',
  'expertise_signals', 'experience_angle',
  'key_claim_passages', 'outbound_link_targets', 'visual_assets',
  'competitor_gap_insight',
  'claim_categories',   // guarded: unverifiable identifiers stripped
  'heading_structure',  // guarded: measured seeds and mandatory rows preserved
])

// Fields the model may NEVER write: measured metrics, deterministic map data,
// human-supplied Sullivan evidence, and identity/lifecycle.
const PROTECTED = Object.freeze([
  'brief_id', 'created', 'site_url', 'target_url', 'status',
  'section', 'subsection', 'priority', 'node_type', 'fan_out_tag',
  'publication_phase', 'publication_order',
  'url_slug', 'primary_keyword', 'secondary_keywords', 'search_intent',
  'ymyl', 'word_count_target', 'reading_time_estimate', 'schema_type', 'content_format',
  'locale', 'orthography_notes', 'faq_sweep',
  'content_type', 'forcing_inputs',
  'author_required', 'reviewer_required', 'ymyl_level', 'safe_answer_required',
  'central_entity', 'entity_wikidata', 'entity_schema_same_as',
  'passage_independence', 'passage_independence_reason', 'gen_intent', 'gen_intent_signal',
  'internal_link_targets', 'competitor_pages_to_beat', 'competitor_benchmarks',
  'dependencies', 'review_required', 'compliance_notes', 'llms_txt_tier',
  'seo_blog_generator_version', 'topical_map_version', 'heading_seed_provenance',
])

// Per-heading fields the model may fill on an existing (measured) heading row.
const HEADING_WRITABLE = Object.freeze([
  'heading_level', 'format', 'starting_statement', 'instruction',
  'context_terms', 'inline_link', 'extractive_answer_target', 'source_ledger_seeds',
  'ple_unit',
])

// Identifier shapes the model cannot verify in this pipeline. Recalling a PMID,
// DOI, or deep URL from training data is precisely how fabricated citations enter a
// brief, so we strip the identifier, keep the descriptive text, and mark the claim.
// Deliberately STRICTER than the skill (which allows a PMID "if known from session
// context") — nothing in this pipeline establishes that context.
//
// Deliberately NOT stripped: a bare hostname with no path (e.g. "sec.gov"). Section 9
// asks for authoritative *domains*, which are a category of source, not a specific
// checkable claim. A domain WITH a path ("sec.gov/litigation/12345") is a specific
// claim about a page that may not exist, so it is stripped.
//
// No \b anchors: `\b` fails on glue like "researchPMID:12345678".
const IDENTIFIER_PATTERNS = [
  /pmc?id\s*:?\s*\d+/gi,                       // PMID / PMCID, prefixed or glued
  /(?:doi\s*:?\s*)?10\.\d{4,9}\/[^\s,;)\]]+/gi, // DOI, with or without the doi: marker
  /[a-z][a-z0-9+.-]*:\/\/\S+/gi,                // any scheme incl. defanged hxxps://
  /[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+/gi,          // bare domain WITH a path
  /Q\d{4,}/g,                                   // Wikidata Q-ID (rule 4)
  // Ahrefs Domain Rating claims. Measured DR only ever lives in the PROTECTED
  // competitor_benchmarks, so a DR figure appearing in enrichable free text is
  // necessarily model-invented (rule 1).
  /\bDR\s*:?\s*\d{1,3}\b/gi,
]

const isStr = (v) => typeof v === 'string' && v.trim() !== ''

function stripUnverifiableIdentifiers(value) {
  if (!isStr(value)) return { value, stripped: false }
  let out = value
  let stripped = false
  for (const re of IDENTIFIER_PATTERNS) {
    re.lastIndex = 0
    if (re.test(out)) {
      stripped = true
      re.lastIndex = 0
      out = out.replace(re, '').replace(/\s{2,}/g, ' ').replace(/[\s,;(]+$/, '').trim()
    }
    re.lastIndex = 0
  }
  if (!stripped) return { value, stripped: false }
  const cleaned = out || 'Unnamed source'
  return {
    value: cleaned.includes(PLACEHOLDER.UNVERIFIED) ? cleaned : `${cleaned} ${PLACEHOLDER.UNVERIFIED}`,
    stripped: true,
  }
}

// Recursively scrub EVERY string leaf of an enrichable value. The earlier version
// only guarded claim_categories, which left 14 other enrichable fields as bare
// write-throughs — a fabricated Q-ID or PMID could simply be routed through
// `predicates` or `key_entities` instead. Depth-capped against pathological nesting.
function scrubDeep(value, report, field, depth = 0) {
  if (depth > 6) return null
  if (typeof value === 'string') {
    const { value: v, stripped } = stripUnverifiableIdentifiers(value)
    if (stripped) report.push({ field, reason: 'unverifiable identifier stripped', original: value })
    return v
  }
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, report, field, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = scrubDeep(value[k], report, field, depth + 1)
    return out
  }
  return value
}

// Section 9 wants authoritative DOMAINS. Keep the host, drop any path/query so a
// model cannot smuggle a specific (unverifiable) deep link in as a "source".
function normalizeOutboundTargets(value, report) {
  const list = Array.isArray(value) ? value : [value]
  return list.filter(isStr).map((entry) => {
    const trimmed = entry.trim()
    const m = trimmed.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s]*)?(.*)$/i)
    if (!m) return scrubDeep(trimmed, report, 'outbound_link_targets')
    const [, host, path, rest] = m
    if (path) report.push({ field: 'outbound_link_targets', reason: 'deep path removed — domain kept', original: trimmed })
    return `${host}${rest ? ` ${rest.trim()}` : ''}`.trim()
  })
}

// Claim seeds are search TARGETS, not verified citations — scrub every entry.
function guardClaimList(list, report, field = 'claim_categories') {
  if (!Array.isArray(list)) return [PLACEHOLDER.UNVERIFIED]
  const out = []
  for (const entry of list) {
    if (!isStr(entry)) continue
    out.push(scrubDeep(entry, report, field))
  }
  return out.length ? out : [PLACEHOLDER.UNVERIFIED]
}

function guardClaimCategories(assembled, incoming, report) {
  const base = assembled && typeof assembled === 'object' ? assembled : {}
  const next = { ...base }
  if (!incoming || typeof incoming !== 'object') return next
  for (const key of ['clinical_evidence', 'regulatory_status', 'epidemiology', 'expert_sources']) {
    if (incoming[key] !== undefined) next[key] = guardClaimList(incoming[key], report)
  }
  if (incoming.competitor_benchmarks !== undefined) {
    report.push({ field: 'claim_categories.competitor_benchmarks', reason: 'tool-only field — model output discarded' })
  }
  next.competitor_benchmarks = [PLACEHOLDER.NO_DATA]
  return next
}

// heading_structure: every measured/mandatory row survives with its h2 and
// provenance intact; the model may only fill the creative per-heading fields.
// It may append NEW headings (the template wants 5–8 H2s, PAA may supply fewer),
// but those are tagged `_seed_source: 'llm'` so a reader can tell an invented
// heading from a SERP-measured one.
function guardHeadingStructure(assembled, incoming, report) {
  const existing = Array.isArray(assembled) ? assembled : []
  if (!Array.isArray(incoming)) return existing

  const byH2 = new Map()
  for (const row of incoming) {
    if (row && typeof row === 'object' && isStr(row.h2)) byH2.set(row.h2.trim(), row)
  }

  const merged = existing.map((row) => {
    const match = byH2.get(String(row.h2).trim())
    if (!match) return row
    byH2.delete(String(row.h2).trim())
    const next = { ...row }
    for (const f of HEADING_WRITABLE) {
      if (match[f] === undefined) continue
      if (f === 'source_ledger_seeds') {
        next[f] = guardClaimList(match[f], report)
      } else {
        next[f] = match[f]
      }
    }
    // h2 text and provenance are never rewritten on a measured row.
    next.h2 = row.h2
    next._seed_source = row._seed_source
    if (row._mandatory) next._mandatory = true
    return next
  })

  // Anything left over is a model-invented heading.
  for (const [h2, row] of byH2) {
    const added = { h2, _seed_source: 'llm' }
    for (const f of HEADING_WRITABLE) {
      added[f] = f === 'source_ledger_seeds' ? guardClaimList(row[f], report) : (row[f] ?? PLACEHOLDER.PENDING_LLM)
    }
    added.heading_level = isStr(row.heading_level) ? row.heading_level : 'H2'
    merged.push(added)
  }
  return merged
}

/**
 * Merge an LLM enrichment payload into an assembled brief, enforcing the honesty
 * contract structurally.
 *
 * @returns { brief, rejected: [{field, reason}], enriched: [field] }
 */
function mergeEnrichment(assembled, llmOutput) {
  const base = assembled && typeof assembled === 'object' ? { ...assembled } : {}
  const out = { ...base }
  const rejected = []
  const enriched = []
  const src = llmOutput && typeof llmOutput === 'object' && !Array.isArray(llmOutput) ? llmOutput : {}
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  for (const key of Object.keys(src)) {
    if (PROTECTED.includes(key)) {
      rejected.push({ field: key, reason: 'protected — measured, deterministic, or human-supplied' })
      continue
    }
    if (!ENRICHABLE.includes(key)) {
      rejected.push({ field: key, reason: 'not an enrichable brief field' })
      continue
    }

    const value = src[key]
    let next

    if (key === 'claim_categories') {
      next = guardClaimCategories(base[key], value, rejected)
    } else if (key === 'heading_structure') {
      next = guardHeadingStructure(base[key], value, rejected)
    } else if (key === 'experience_angle') {
      // Hybrid field: the assembler fills it from the human-supplied Sullivan
      // `recurring_pattern` when one exists. The model may only write it when it is
      // still the untouched placeholder — otherwise it would overwrite the author's
      // own first-hand evidence with an invented story.
      if (base[key] !== PLACEHOLDER.PENDING_LLM) {
        rejected.push({ field: key, reason: 'human-supplied (Sullivan forcing input) — protected' })
        continue
      }
      next = scrubDeep(value, rejected, key)
    } else if (key === 'outbound_link_targets') {
      next = normalizeOutboundTargets(value, rejected)
    } else {
      // Every remaining enrichable field is deep-scrubbed: a fabricated identifier
      // must not be smuggled in through predicates/key_entities/visual_assets/etc.
      next = scrubDeep(value, rejected, key)
    }

    if (next === null || next === undefined || (typeof next === 'string' && next.trim() === '')) {
      rejected.push({ field: key, reason: 'empty value' })
      continue
    }
    if (Array.isArray(next) && next.length === 0) {
      rejected.push({ field: key, reason: 'empty value' })
      continue
    }

    out[key] = next
    // Report enrichment only when the value ACTUALLY changed — otherwise the UI
    // claims "enriched N sections" for output the guard silently discarded.
    if (!same(base[key], next)) enriched.push(key)
    else rejected.push({ field: key, reason: 'no change after guarding' })
  }

  return { brief: out, rejected, enriched }
}

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildEnrichmentPrompt(brief, topic = {}) {
  const system = `You write content briefs for a YMYL crypto-scam investigation site. You are filling ONLY the creative sections of an already-assembled brief.

ABSOLUTE RULES — violating any of these invalidates your output:
1. NEVER invent a PMID, DOI, study identifier, or URL. Claim categories are SEARCH TARGETS, not verified citations. Describe what to look for, then write exactly: ${PLACEHOLDER.UNVERIFIED}
2. NEVER output competitor metrics (word counts, DR, traffic). That data is not available to you.
3. NEVER output a Wikidata Q-ID or sameAs URL.
4. Do NOT restate or alter any field not listed in the output schema below — they are measured or human-supplied and will be discarded if you emit them.
5. Preserve every existing h2 string in heading_structure EXACTLY. They were derived from measured SERP People-Also-Ask data. You may add extra H2s to reach 5–8 total.
6. The two headings marked mandatory must keep their role: one names who this is NOT for (include a line a competitor would never publish), the final one is action-oriented, never titled "Conclusion".
7. Do NOT invent faq_sweep volumes, competitor DR/traffic, or a locale tag. Leave locale empty unless the brief already has a real BCP-47 value.

Return ONLY a JSON object. No markdown fences, no commentary.

Output schema (emit only these keys):
{
  "title_tag": "≤60 chars, primary keyword + entity + attribute",
  "meta_description": "150-160 chars, primary keyword in first 50 chars",
  "h1": "≤60 chars, primary keyword natural",
  "h1_coverage_manifest": "implicit definition, then pipe-separated list of every sub-aspect to cover",
  "bluf_target": "40-60 words answering the core query, entity in subject position",
  "key_entities": [{"entity":"","attribute":"","value":""}],
  "related_entities": ["Entity — one-phrase role on this page"],
  "ngram_relations": {"meronyms":[],"synonyms":[],"antonyms":[],"hypernyms":[],"hyponyms":[]},
  "predicates": ["entity does/causes/is-treated-by object"],
  "expertise_signals": ["credential or authority signal needed"],
  "key_claim_passages": ["Entity verb claim — passage covering sub-topic"],
  "outbound_link_targets": ["domain.com — why it is authoritative here"],
  "visual_assets": [{"type":"diagram|comparison_table|chart|screenshot|infographic","description":"","alt_text":"","placement":"after [H2 title]"}],
  "competitor_gap_insight": "what competitor pages do NOT cover that this brief should own",
  "claim_categories": {"clinical_evidence":[],"regulatory_status":[],"epidemiology":[],"expert_sources":[]},
  "heading_structure": [{"h2":"","heading_level":"H2","format":"Paragraph|Unordered List|Table|FS|PAA","starting_statement":"verbatim answer-first opening sentence","instruction":"what to include/exclude, tone, scope","context_terms":["5-12 terms"],"inline_link":"none or {anchor,target}","extractive_answer_target":"40-60 word answer, declaration first","source_ledger_seeds":["claim type to research"]}]
}`

  const existingHeadings = Array.isArray(brief.heading_structure)
    ? brief.heading_structure.map((h) => `- "${h.h2}"${h._mandatory ? '  [MANDATORY]' : '  [from measured SERP PAA — keep verbatim]'}`).join('\n')
    : '(none)'

  const user = `TOPIC: ${brief.primary_keyword || topic.title || ''}
Page title: ${topic.title || ''}
Central entity: ${brief.central_entity || ''}
Search intent: ${brief.search_intent}
Content format: ${brief.content_format}
Schema type: ${brief.schema_type}
Word count target: ${brief.word_count_target}
Section / role: ${brief.section} / ${brief.node_type}
Secondary keywords: ${(brief.secondary_keywords || []).join(', ') || '(none)'}
YMYL: ${brief.ymyl} (level ${brief.ymyl_level})

NON-COMMODITY ANGLE (human-supplied — build the brief around this, do not contradict it):
content_type: ${brief.content_type || '(none)'}
${brief.forcing_inputs ? JSON.stringify(brief.forcing_inputs, null, 2) : '(none)'}

EXISTING HEADINGS — reproduce these h2 strings exactly, then add more to reach 5-8:
${existingHeadings}

Generate the JSON now.`

  return { system, user }
}

module.exports = {
  ENRICHABLE, PROTECTED, HEADING_WRITABLE,
  stripUnverifiableIdentifiers, scrubDeep, normalizeOutboundTargets,
  mergeEnrichment, buildEnrichmentPrompt,
}
