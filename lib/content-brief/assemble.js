'use strict'

// Deterministic assembler for the full 12-section content brief
// (content-brief-generator v1.4, references/brief-template.md).
//
// Field names and section order are FIXED — seo-blog-generator parses them at its
// Step 1. Do not rename or drop a field.
//
// HONESTY CONTRACT. Every field is either:
//   (a) derived from persisted, measured map data, or
//   (b) filled with a LITERAL placeholder naming what is missing and who resolves it.
// Nothing is ever guessed. The placeholders are the skill's own strings so a
// downstream reader (or the LLM enrichment step) can tell "not yet generated" from
// "tool data unavailable" from "unverifiable".
//
// `created` is an explicit argument — this module never reads a clock, so the same
// inputs always assemble the same brief.

const { slugify } = require('../topical-map/text-utils')
const { resolveSlug, lookupEntity, buildSchemaEntity } = require('../wikidata-registry')

const PLACEHOLDER = Object.freeze({
  NO_DATA: '[NO DATA — requires Tool-Assisted mode]',
  UNVERIFIED: '[UNVERIFIED — editor must locate]',
  UNRESOLVED_QID: '[UNRESOLVED — verify at wikidata.org]',
  DERIVED_NOT_SERP: '[DERIVED — not SERP-validated]',
  // Not a skill string: distinguishes "enrichment step hasn't run yet" from the
  // above, which mean "the data does not exist / cannot be verified".
  PENDING_LLM: '[PENDING — LLM enrichment not run]',
  // For map-classified fields (content_format / schema_type / search_intent) that
  // the pipeline simply hasn't populated — e.g. a topic created before the v4.6
  // migrations. Saying "not SERP-validated" would misdescribe why it is missing;
  // this names the real cause and the fix.
  NOT_CLASSIFIED: '[NOT CLASSIFIED — regenerate the map to populate this field]',
})

// Verified against the INSTALLED skill (~/.claude/skills/seo-blog-generator/SKILL.md
// → "Current version: v5.2.1"), not the illustrative "3.1" in the brief template's
// example block. Update this when the downstream pipeline is upgraded — a brief
// that claims the wrong target version is a checkable fact rendered without checking.
const SEO_BLOG_GENERATOR_VERSION = '5.4'
const TOPICAL_MAP_VERSION = '4.9'

// Word-count targets per content format (template Section 3 guidance).
const WORD_COUNT_BY_FORMAT = Object.freeze({
  'Evergreen Article': 2500,
  'Comparison Table': 1800,
  'Step-by-step Guide': 1800,
  'FAQ Hub': 1500,
  'Listicle': 1500,
  'Calculator / Interactive Tool': 1000,
  'Landing Page (Commercial)': 1200,
  'News / Update': 900,
})
const DEFAULT_WORD_COUNT = 1500

// topic.search_intent → template Section 3 intent codes.
const INTENT_CODE = Object.freeze({
  informational: 'I',
  commercial: 'C',
  transactional: 'T',
  navigational: 'N',
  generative: 'GEN',
})

const NODE_TYPE_LABEL = Object.freeze({ quality: 'Quality Node', trending: 'Trending Node', standard: 'Standard' })

const isStr = (v) => typeof v === 'string' && v.trim() !== ''
const cleanList = (v) => (Array.isArray(v) ? v.filter((x) => isStr(x)).map((x) => x.trim()) : [])

// `dependencies` and `internal_links_to` are persisted by stageLinking as BARE
// SLUGS (`n._dependencies = [parentSlug]`, `n._internal_links_to = [...slugs]`),
// not URL paths. Resolve them through the map's slug→url_path index when the
// caller supplies one. An unresolved slug passes through UNCHANGED rather than
// being dressed up as `/slug/` — inventing a path for a page whose real path we
// cannot look up is the same class of error as inventing an identifier.
function resolvePaths(slugs, slugToPath) {
  const lookup = slugToPath instanceof Map
    ? (s) => slugToPath.get(s)
    : (slugToPath && typeof slugToPath === 'object' ? (s) => slugToPath[s] : () => undefined)
  return cleanList(slugs).map((s) => {
    const path = lookup(s)
    return isStr(path) ? path : s
  })
}

function priorityBand(score) {
  if (!Number.isFinite(score)) return 'Medium'
  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

function fanOutTag(topic) {
  if (!isStr(topic.fan_out_tag)) return ''
  return topic.node_type === 'quality' ? '[FAN-OUT PARENT]' : '[FAN-OUT BRANCH]'
}

// Entity resolution against the curated registry. A miss yields the skill's
// literal UNRESOLVED string — never a fabricated Q-ID (HONESTY RULE 4).
function resolveEntity(topic) {
  for (const candidate of [topic.target_keyword, topic.title].filter(isStr)) {
    const slug = resolveSlug(slugify(candidate))
    if (!slug) continue
    const entry = lookupEntity(slug)
    const schema = buildSchemaEntity(slug)
    return {
      name: entry?.name || candidate,
      qid: entry?.qid_override || entry?.qid || null,
      same_as: Array.isArray(schema?.sameAs) ? schema.sameAs : [],
    }
  }
  return null
}

// GEN intent is asserted ONLY from a measured signal (HONESTY RULE 3): an
// ai_overview SERP feature captured by the map. Never inferred from vibes.
function genIntent(topic) {
  const features = cleanList(topic.serp_features).map((f) => f.toLowerCase())
  if (features.some((f) => f.includes('ai_overview') || f.includes('ai overview'))) {
    return { gen: true, signal: 'AI Overview currently fires on this query (measured: ai_overview in captured SERP features)' }
  }
  return { gen: false, signal: null }
}

function llmsTxtTier(topic) {
  if (topic.node_function === 'authority' || topic.topic_type === 'pillar') return 'Core Pages'
  if (topic.node_function === 'commercial') return 'Core Pages'
  if (topic.node_function === 'retrieval' || topic.node_function === 'entity') return 'Reference Data'
  return 'Supporting Context'
}

/**
 * Assemble the full 12-section brief.
 *
 * @param input {
 *   topic, parentTopic, siteUrl, created (YYYY-MM-DD),
 *   sullivan: { content_type, forcing_inputs }  // must already have passed the gate
 *   publication: { week, target_date, order }
 *   ymyl (default true — crypto/financial is YMYL)
 * }
 */
function assembleBrief(input = {}) {
  const {
    topic: rawTopic, parentTopic = null, siteUrl = '', created = null,
    sullivan = null, publication = null, ymyl = true, slugToPath = null,
  } = input
  const topic = rawTopic && typeof rawTopic === 'object' ? rawTopic : {}

  const urlSlug = isStr(topic.url_path) ? topic.url_path : (isStr(topic.slug) ? `/${topic.slug}` : '')
  const primaryKeyword = isStr(topic.target_keyword) ? topic.target_keyword : (isStr(topic.title) ? topic.title : '')
  const contentFormat = isStr(topic.content_format) ? topic.content_format : null
  const wordCount = (contentFormat && WORD_COUNT_BY_FORMAT[contentFormat]) || DEFAULT_WORD_COUNT
  const entity = resolveEntity(topic)
  const { gen, signal } = genIntent(topic)

  const baseIntent = INTENT_CODE[topic.search_intent] || null
  const searchIntent = baseIntent
    ? (gen && baseIntent !== 'GEN' ? `${baseIntent} + GEN` : baseIntent)
    : (gen ? 'GEN' : PLACEHOLDER.NOT_CLASSIFIED)

  // passage_independence: 'required' only with a stated reason (HONESTY RULE 5).
  const isQuality = topic.node_type === 'quality'
  const passageIndependence = gen || isQuality ? 'required' : (priorityBand(topic.priority_score) === 'High' ? 'recommended' : 'optional')

  const brief = {}

  // ── SECTION 1: IDENTITY ────────────────────────────────────────────────────
  const slugPart = slugify(topic.slug || primaryKeyword || topic.title || 'topic')
  brief.brief_id = created ? `cbr-${slugPart}-${created}` : `cbr-${slugPart}`
  brief.created = created
  brief.site_url = siteUrl || null
  brief.target_url = siteUrl && urlSlug ? `${String(siteUrl).replace(/\/$/, '')}${urlSlug}` : (urlSlug || null)
  brief.status = 'draft'

  // ── SECTION 2: TOPICAL MAP PLACEMENT ───────────────────────────────────────
  brief.section = topic.section === 'outer' ? 'Outer' : 'Core'
  brief.subsection = isStr(parentTopic?.title) ? parentTopic.title : null
  brief.priority = priorityBand(topic.priority_score)
  brief.node_type = NODE_TYPE_LABEL[topic.node_type] || 'Standard'
  brief.fan_out_tag = fanOutTag(topic)
  brief.publication_phase = publication?.week
    ? `Week ${publication.week}${publication.target_date ? ` (${publication.target_date})` : ''}`
    : null
  brief.publication_order = Number.isFinite(publication?.order) ? publication.order : null

  // ── SECTION 3: CONTENT METADATA ────────────────────────────────────────────
  brief.title_tag = PLACEHOLDER.PENDING_LLM
  brief.url_slug = urlSlug || null
  brief.meta_description = PLACEHOLDER.PENDING_LLM
  brief.primary_keyword = primaryKeyword || null
  brief.secondary_keywords = cleanList(topic.secondary_keywords)
  brief.search_intent = searchIntent
  brief.ymyl = !!ymyl
  brief.word_count_target = wordCount
  brief.reading_time_estimate = `~${Math.max(1, Math.round(wordCount / 225))} min`
  brief.schema_type = isStr(topic.schema_type) ? topic.schema_type : PLACEHOLDER.NOT_CLASSIFIED
  brief.content_format = contentFormat || PLACEHOLDER.NOT_CLASSIFIED

  // ── SECTION 3.5: NON-COMMODITY CLASSIFICATION (Sullivan Gate) ──────────────
  // Carried through ONLY from validated, human-supplied input. Never inferred.
  brief.content_type = isStr(sullivan?.content_type) ? sullivan.content_type : null
  brief.forcing_inputs = sullivan?.forcing_inputs && typeof sullivan.forcing_inputs === 'object' && !Array.isArray(sullivan.forcing_inputs)
    ? sullivan.forcing_inputs
    : null

  // ── SECTION 4: E-E-A-T REQUIREMENTS ────────────────────────────────────────
  brief.author_required = ymyl
    ? 'Subject-matter expert with verifiable credentials in crypto fraud / financial investigation'
    : 'Subject matter expert'
  brief.reviewer_required = !!ymyl
  brief.ymyl_level = ymyl ? 'High' : 'Low'
  // A firsthand_review supplies its own experience angle via the gate — reuse it
  // rather than asking the LLM to invent one.
  brief.experience_angle = isStr(sullivan?.forcing_inputs?.recurring_pattern)
    ? sullivan.forcing_inputs.recurring_pattern
    : PLACEHOLDER.PENDING_LLM
  brief.expertise_signals = PLACEHOLDER.PENDING_LLM
  brief.safe_answer_required = !!ymyl

  // ── SECTION 5: ENTITY CONTEXT ──────────────────────────────────────────────
  brief.central_entity = entity?.name || (isStr(topic.title) ? topic.title : null)
  brief.entity_wikidata = entity?.qid || PLACEHOLDER.UNRESOLVED_QID
  brief.entity_schema_same_as = entity?.same_as?.length ? entity.same_as : [PLACEHOLDER.UNRESOLVED_QID]
  brief.key_entities = PLACEHOLDER.PENDING_LLM
  brief.related_entities = PLACEHOLDER.PENDING_LLM
  brief.ngram_relations = PLACEHOLDER.PENDING_LLM
  brief.predicates = PLACEHOLDER.PENDING_LLM

  // ── SECTION 6: HEADING SKELETON ────────────────────────────────────────────
  brief.h1 = PLACEHOLDER.PENDING_LLM
  brief.h1_coverage_manifest = PLACEHOLDER.PENDING_LLM
  brief.bluf_target = PLACEHOLDER.PENDING_LLM
  // PAA questions are SERP-measured, so they are honest H2 seeds. The per-heading
  // methodology blocks are LLM work (6c); scaffolded, not invented.
  const paa = cleanList(topic.paa_questions)
  // Every heading row must carry all 8 per-heading fields (template: "never omit
  // the field"). `_seed_source` is internal provenance, stripped at YAML export.
  const headingBlock = (h2, seedSource, over = {}) => ({
    h2,
    heading_level: 'H2',
    format: PLACEHOLDER.PENDING_LLM,
    starting_statement: PLACEHOLDER.PENDING_LLM,
    instruction: PLACEHOLDER.PENDING_LLM,
    context_terms: PLACEHOLDER.PENDING_LLM,
    inline_link: 'none',
    extractive_answer_target: PLACEHOLDER.PENDING_LLM,
    source_ledger_seeds: [PLACEHOLDER.UNVERIFIED],
    _seed_source: seedSource,
    ...over,
  })
  brief.heading_structure = [
    ...paa.map((q) => headingBlock(q, 'serp_paa')), // measured
    // The template MANDATES these two as heading_structure entries, regardless of
    // SERP data — the "Not For You" block is a hard requirement of
    // seo-blog-generator, and the final H2 must be action-oriented, not a conclusion.
    headingBlock('When [Topic] Is NOT the Right Choice', 'mandatory_template', { _mandatory: true }),
    headingBlock('[Action-Oriented Final H2 — not "Conclusion"]', 'mandatory_template', {
      _mandatory: true,
      inline_link: PLACEHOLDER.PENDING_LLM, // CTA link belongs on this heading
      source_ledger_seeds: [],
    }),
  ]
  brief.heading_seed_provenance = paa.length ? 'serp_paa (measured)' : PLACEHOLDER.DERIVED_NOT_SERP

  // ── SECTION 7: CLAIM CATEGORIES ────────────────────────────────────────────
  // Never invent PMIDs/DOIs/URLs (HONESTY RULE 2).
  brief.claim_categories = {
    clinical_evidence: [PLACEHOLDER.UNVERIFIED],
    regulatory_status: [PLACEHOLDER.UNVERIFIED],
    epidemiology: [PLACEHOLDER.UNVERIFIED],
    expert_sources: [PLACEHOLDER.UNVERIFIED],
    competitor_benchmarks: [PLACEHOLDER.NO_DATA],
  }

  // ── SECTION 8: PASSAGE INDEPENDENCE ────────────────────────────────────────
  brief.passage_independence = passageIndependence
  // HONESTY RULE 5: never mark `required` without stating why. The GEN branch states
  // it via gen_intent_signal; a Quality Node marked required needs its own stated
  // reason, so it is recorded here rather than left implicit.
  brief.passage_independence_reason = passageIndependence === 'required'
    ? (gen ? signal : 'Quality Node — fan-out hub whose child passages must be independently extractable (measured: node_type=quality)')
    : (passageIndependence === 'recommended' ? 'High-priority page (measured: priority_score band)' : null)
  brief.gen_intent = gen
  brief.gen_intent_signal = signal || (gen ? PLACEHOLDER.DERIVED_NOT_SERP : null)
  brief.key_claim_passages = PLACEHOLDER.PENDING_LLM

  // ── SECTION 9: INTERNAL LINKING ────────────────────────────────────────────
  const seedPages = []
  if (isStr(parentTopic?.url_path)) seedPages.push(parentTopic.url_path)
  else if (isStr(parentTopic?.slug)) seedPages.push(`/${parentTopic.slug}`)
  brief.internal_link_targets = {
    root: '/',
    seed_pages: seedPages,
    node_pages: resolvePaths(topic.internal_links_to, slugToPath),
  }
  brief.outbound_link_targets = PLACEHOLDER.PENDING_LLM

  // ── SECTION 10: VISUAL REQUIREMENTS ────────────────────────────────────────
  brief.visual_assets = PLACEHOLDER.PENDING_LLM

  // ── SECTION 11: COMPETITOR BENCHMARKS ──────────────────────────────────────
  // Never invent traffic/DR numbers. Only measured values are filled.
  const measuredFeatures = cleanList(topic.serp_features)
  const drMedian = topic.serp_authority?.dr_median
  const drMin = topic.serp_authority?.dr_min
  // The field is named avg_dr, so use the MEDIAN (the honest central-tendency proxy
  // the map already measures). dr_min is the weakest competitor in the top results —
  // shipping it under an "avg" label would understate the authority bar to an editor.
  // If only the minimum exists, say so explicitly rather than implying an average.
  const avgDr = Number.isFinite(drMedian)
    ? `median DR ${drMedian} (measured, top-results median)`
    : (Number.isFinite(drMin) ? `DR ${drMin} — MINIMUM of top results, not an average (measured)` : PLACEHOLDER.NO_DATA)
  // Measured top organic results for this keyword (SERP stage), our own domains
  // already excluded. Absent on maps generated before migration 021.
  const competitorUrls = cleanList(topic.competitor_urls)
  brief.competitor_pages_to_beat = competitorUrls.length ? competitorUrls : [PLACEHOLDER.NO_DATA]
  brief.competitor_gap_insight = PLACEHOLDER.PENDING_LLM
  brief.competitor_benchmarks = {
    word_count: PLACEHOLDER.NO_DATA,
    avg_dr: avgDr,
    serp_features: measuredFeatures.length ? measuredFeatures : PLACEHOLDER.NO_DATA,
  }

  // ── SECTION 12: PUBLICATION & COMPLIANCE METADATA ──────────────────────────
  brief.dependencies = resolvePaths(topic.dependencies, slugToPath)
  brief.review_required = !!ymyl
  brief.compliance_notes = ymyl
    ? 'YMYL-Financial: crypto/scam content. Editorial review mandatory. FTC disclosure required for any affiliate placement; no investment advice.'
    : PLACEHOLDER.PENDING_LLM
  brief.llms_txt_tier = llmsTxtTier(topic)
  brief.seo_blog_generator_version = SEO_BLOG_GENERATOR_VERSION
  brief.topical_map_version = TOPICAL_MAP_VERSION

  return brief
}

module.exports = { PLACEHOLDER, WORD_COUNT_BY_FORMAT, assembleBrief }
