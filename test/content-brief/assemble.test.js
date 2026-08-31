const { test } = require('node:test'); const assert = require('node:assert/strict')
const { PLACEHOLDER, assembleBrief } = require('../../lib/content-brief/assemble')

const TOPIC = {
  id: 't1', title: 'How Rug Pulls Work', slug: 'how-rug-pulls-work', url_path: '/crypto-scams/rug-pulls/',
  target_keyword: 'how rug pulls work', secondary_keywords: ['rug pull signs', 'rug pull recovery'],
  section: 'core', topic_type: 'cluster', node_type: 'standard', node_function: 'reinforcement',
  priority_score: 75, search_intent: 'informational', content_format: 'Evergreen Article',
  schema_type: 'Article', paa_questions: ['What is a rug pull?', 'How do I spot a rug pull?'],
  serp_features: ['people_also_ask', 'ai_overview'], serp_authority: { dr_min: 42, dr_median: 55 },
  // NOTE: stageLinking persists these as BARE SLUGS, not paths. Fixtures mirror reality.
  internal_links_to: ['spot-a-scam'], dependencies: ['crypto-scams'], fan_out_tag: null,
}
const PARENT = { title: 'Crypto Scams', url_path: '/crypto-scams/' }
const SULLIVAN = {
  content_type: 'firsthand_review',
  forcing_inputs: { direct_anecdotes: ['a', 'b', 'c'], field_observation_count: '400 callouts since 2019', recurring_pattern: 'Withdrawal freeze after first win', credentials: 'Lead investigator, 6y' },
}
const build = (over = {}) => assembleBrief({
  topic: TOPIC, parentTopic: PARENT, siteUrl: 'https://crypto-killer.vercel.app',
  created: '2026-07-19', sullivan: SULLIVAN, publication: { week: 2, target_date: '2026-07-27', order: 5 },
  ...over,
})

// ── Section 1 ────────────────────────────────────────────────────────────────
test('S1 identity: brief_id follows cbr-[slug]-[YYYY-MM-DD]; status starts draft', () => {
  const b = build()
  assert.equal(b.brief_id, 'cbr-how-rug-pulls-work-2026-07-19')
  assert.equal(b.created, '2026-07-19')
  assert.equal(b.status, 'draft')
  assert.equal(b.target_url, 'https://crypto-killer.vercel.app/crypto-scams/rug-pulls/')
})

test('S1: no created date -> no fabricated date anywhere', () => {
  const b = build({ created: null })
  assert.equal(b.created, null)
  assert.equal(b.brief_id, 'cbr-how-rug-pulls-work')
})

// ── Section 2 ────────────────────────────────────────────────────────────────
test('S2 placement maps section/priority/node_type and the publication plan', () => {
  const b = build()
  assert.equal(b.section, 'Core')
  assert.equal(b.subsection, 'Crypto Scams')
  assert.equal(b.priority, 'High') // 75
  assert.equal(b.node_type, 'Standard')
  assert.equal(b.publication_phase, 'Week 2 (2026-07-27)')
  assert.equal(b.publication_order, 5)
})

test('S2 priority bands and Outer section', () => {
  assert.equal(build({ topic: { ...TOPIC, priority_score: 55 } }).priority, 'Medium')
  assert.equal(build({ topic: { ...TOPIC, priority_score: 10 } }).priority, 'Low')
  assert.equal(build({ topic: { ...TOPIC, section: 'outer' } }).section, 'Outer')
  assert.equal(build({ topic: { ...TOPIC, node_type: 'quality' } }).node_type, 'Quality Node')
})

test('S2 fan_out_tag: parent vs branch vs blank', () => {
  assert.equal(build({ topic: { ...TOPIC, fan_out_tag: 'x', node_type: 'quality' } }).fan_out_tag, '[FAN-OUT PARENT]')
  assert.equal(build({ topic: { ...TOPIC, fan_out_tag: 'x', node_type: 'standard' } }).fan_out_tag, '[FAN-OUT BRANCH]')
  assert.equal(build().fan_out_tag, '')
})

// ── Section 3 ────────────────────────────────────────────────────────────────
test('S3 metadata: deterministic fields filled, creative fields pending (never invented)', () => {
  const b = build()
  assert.equal(b.url_slug, '/crypto-scams/rug-pulls/')
  assert.equal(b.primary_keyword, 'how rug pulls work')
  assert.deepEqual(b.secondary_keywords, ['rug pull signs', 'rug pull recovery'])
  assert.equal(b.schema_type, 'Article')
  assert.equal(b.content_format, 'Evergreen Article')
  assert.equal(b.word_count_target, 2500)
  assert.equal(b.reading_time_estimate, '~11 min')
  assert.equal(b.title_tag, PLACEHOLDER.PENDING_LLM)
  assert.equal(b.meta_description, PLACEHOLDER.PENDING_LLM)
})

test('S3 v1.6 locale is empty (never invented) and headings carry ple_unit + faq_sweep', () => {
  const b = build()
  assert.equal(b.locale, '')
  assert.equal(b.orthography_notes, '')
  assert.ok(b.faq_sweep && Array.isArray(b.faq_sweep.items))
  assert.equal(b.faq_sweep.items.length, 0)
  for (const h of b.heading_structure) {
    assert.equal(h.ple_unit.pixel, PLACEHOLDER.PENDING_LLM)
    assert.equal(h.ple_unit.letter, PLACEHOLDER.PENDING_LLM)
    assert.equal(h.ple_unit.byte, PLACEHOLDER.PENDING_LLM)
  }
  const cta = b.heading_structure.find((h) => /Action-Oriented Final/.test(h.h2))
  assert.match(cta.instruction, /escalation ladder/)
  assert.match(cta.instruction, /ic3\.gov/)
})

test('S3 search_intent: measured ai_overview promotes to dual GEN intent', () => {
  assert.equal(build().search_intent, 'I + GEN') // informational + measured ai_overview
  const noAio = build({ topic: { ...TOPIC, serp_features: ['people_also_ask'] } })
  assert.equal(noAio.search_intent, 'I')
})

test('S3 unpopulated map fields say WHY they are missing and how to fix it', () => {
  // pre-v4.6 topics have no content_format/schema_type; "not SERP-validated" would
  // misdescribe the cause, so these use NOT_CLASSIFIED.
  const b = build({ topic: { ...TOPIC, content_format: null, schema_type: null, search_intent: null, serp_features: [] } })
  assert.equal(b.content_format, PLACEHOLDER.NOT_CLASSIFIED)
  assert.equal(b.schema_type, PLACEHOLDER.NOT_CLASSIFIED)
  assert.equal(b.search_intent, PLACEHOLDER.NOT_CLASSIFIED)
  assert.match(PLACEHOLDER.NOT_CLASSIFIED, /regenerate the map/)
})

test('S3 word_count_target varies by content_format, with a default', () => {
  assert.equal(build({ topic: { ...TOPIC, content_format: 'FAQ Hub' } }).word_count_target, 1500)
  assert.equal(build({ topic: { ...TOPIC, content_format: 'News / Update' } }).word_count_target, 900)
  assert.equal(build({ topic: { ...TOPIC, content_format: null } }).word_count_target, 1500)
})

// ── Section 3.5 Sullivan ─────────────────────────────────────────────────────
test('S3.5 carries validated human input through verbatim, never inferred', () => {
  const b = build()
  assert.equal(b.content_type, 'firsthand_review')
  assert.deepEqual(b.forcing_inputs, SULLIVAN.forcing_inputs)
})

test('S3.5 with no gate result -> null, never a guessed content_type', () => {
  const b = build({ sullivan: null })
  assert.equal(b.content_type, null)
  assert.equal(b.forcing_inputs, null)
})

// ── Section 4/5 ──────────────────────────────────────────────────────────────
test('S4 reuses the gate\'s recurring_pattern as the experience angle', () => {
  assert.equal(build().experience_angle, 'Withdrawal freeze after first win')
  assert.equal(build({ sullivan: null }).experience_angle, PLACEHOLDER.PENDING_LLM)
  assert.equal(build().ymyl_level, 'High')
  assert.equal(build({ ymyl: false }).ymyl_level, 'Low')
})

test('S5 entity: registry miss yields the literal UNRESOLVED string, never a fake Q-ID', () => {
  const b = build()
  assert.equal(b.entity_wikidata, PLACEHOLDER.UNRESOLVED_QID)
  assert.deepEqual(b.entity_schema_same_as, [PLACEHOLDER.UNRESOLVED_QID])
  assert.equal(b.central_entity, 'How Rug Pulls Work')
})

test('S5 entity: a registry hit fills a real Q-ID + sameAs (qid_override honored)', () => {
  const b = build({ topic: { ...TOPIC, target_keyword: 'better business bureau', title: 'BBB' } })
  assert.equal(b.entity_wikidata, 'Q806097')
  assert.ok(b.entity_schema_same_as.some((u) => u.includes('Q806097')))
})

// ── Section 6 ────────────────────────────────────────────────────────────────
test('S6 seeds H2s from measured PAA and marks provenance', () => {
  const b = build()
  const paaHeads = b.heading_structure.filter((h) => h._seed_source === 'serp_paa')
  assert.deepEqual(paaHeads.map((h) => h.h2), ['What is a rug pull?', 'How do I spot a rug pull?'])
  assert.equal(b.heading_seed_provenance, 'serp_paa (measured)')
  for (const h of paaHeads) {
    assert.equal(h.starting_statement, PLACEHOLDER.PENDING_LLM)
    assert.deepEqual(h.source_ledger_seeds, [PLACEHOLDER.UNVERIFIED])
  }
})

test('S6 with no PAA: only the mandatory headings, flagged as not SERP-validated', () => {
  const b = build({ topic: { ...TOPIC, paa_questions: [] } })
  assert.equal(b.heading_structure.length, 2)
  assert.ok(b.heading_structure.every((h) => h._mandatory))
  assert.equal(b.heading_seed_provenance, PLACEHOLDER.DERIVED_NOT_SERP)
})

test('S6 mandatory headings are entries INSIDE heading_structure (template requirement)', () => {
  const b = build()
  const mandatory = b.heading_structure.filter((h) => h._mandatory)
  assert.equal(mandatory.length, 2)
  assert.match(mandatory[0].h2, /NOT the Right Choice/)
  assert.match(mandatory[1].h2, /Action-Oriented Final H2/)
  assert.equal(b.mandatory_headings, undefined) // no non-spec side-list
})

test('S6 every heading row carries all 8 per-heading fields (never omitted)', () => {
  const required = ['h2', 'heading_level', 'format', 'starting_statement', 'instruction', 'context_terms', 'inline_link', 'extractive_answer_target', 'source_ledger_seeds']
  for (const h of build().heading_structure) {
    for (const f of required) assert.ok(f in h, `heading missing ${f}`)
  }
})

// ── Sections 7/8/11 — honesty-critical ───────────────────────────────────────
test('S7 claim categories never invent sources', () => {
  const c = build().claim_categories
  for (const key of ['clinical_evidence', 'regulatory_status', 'epidemiology', 'expert_sources']) {
    assert.deepEqual(c[key], [PLACEHOLDER.UNVERIFIED], key)
  }
  assert.deepEqual(c.competitor_benchmarks, [PLACEHOLDER.NO_DATA])
})

test('S8 passage independence + GEN signal is stated from a measured signal', () => {
  const b = build()
  assert.equal(b.passage_independence, 'required')
  assert.equal(b.gen_intent, true)
  assert.match(b.gen_intent_signal, /AI Overview currently fires/)
  assert.match(b.gen_intent_signal, /measured/)
})

test('S8 non-GEN standard topic is not marked required without reason', () => {
  const b = build({ topic: { ...TOPIC, serp_features: [], priority_score: 20 } })
  assert.equal(b.gen_intent, false)
  assert.equal(b.gen_intent_signal, null)
  assert.equal(b.passage_independence, 'optional')
})

test('S8 quality node is required even without GEN, WITH a stated reason (rule 5)', () => {
  const b = build({ topic: { ...TOPIC, serp_features: [], node_type: 'quality' } })
  assert.equal(b.passage_independence, 'required')
  assert.match(b.passage_independence_reason, /Quality Node/)
  assert.match(b.passage_independence_reason, /measured/)
})

test('S8 required-by-GEN states the measured GEN signal as its reason', () => {
  const b = build()
  assert.equal(b.passage_independence, 'required')
  assert.match(b.passage_independence_reason, /AI Overview currently fires/)
})

test('S8 optional pages carry no invented reason', () => {
  const b = build({ topic: { ...TOPIC, serp_features: [], priority_score: 20 } })
  assert.equal(b.passage_independence, 'optional')
  assert.equal(b.passage_independence_reason, null)
})

test('S11 fills only measured competitor data, NO DATA otherwise', () => {
  const b = build()
  assert.deepEqual(b.competitor_pages_to_beat, [PLACEHOLDER.NO_DATA])
  assert.equal(b.competitor_benchmarks.word_count, PLACEHOLDER.NO_DATA)
  assert.match(b.competitor_benchmarks.avg_dr, /median DR 55 \(measured/)
  assert.deepEqual(b.competitor_benchmarks.serp_features, ['people_also_ask', 'ai_overview'])
})

test('S11 uses measured competitor URLs when the SERP stage captured them', () => {
  const b = build({ topic: { ...TOPIC, competitor_urls: ['https://rival.com/rug-pulls', 'https://other.com/guide'] } })
  assert.deepEqual(b.competitor_pages_to_beat, ['https://rival.com/rug-pulls', 'https://other.com/guide'])
})

test('S11 competitor pages fall back to NO DATA on pre-migration maps', () => {
  assert.deepEqual(build({ topic: { ...TOPIC, competitor_urls: null } }).competitor_pages_to_beat, [PLACEHOLDER.NO_DATA])
  assert.deepEqual(build({ topic: { ...TOPIC, competitor_urls: [] } }).competitor_pages_to_beat, [PLACEHOLDER.NO_DATA])
})

test('S11 with no measured authority -> NO DATA, never a guessed DR', () => {
  const b = build({ topic: { ...TOPIC, serp_authority: null, serp_features: [] } })
  assert.equal(b.competitor_benchmarks.avg_dr, PLACEHOLDER.NO_DATA)
  assert.equal(b.competitor_benchmarks.serp_features, PLACEHOLDER.NO_DATA)
})

// ── Sections 9/12 ────────────────────────────────────────────────────────────
test('S9 internal linking derives root/seed/node from the map tree', () => {
  const l = build().internal_link_targets
  assert.equal(l.root, '/')
  assert.deepEqual(l.seed_pages, ['/crypto-scams/'])
  // unresolved slug passes through unchanged — never dressed up as an invented path
  assert.deepEqual(l.node_pages, ['spot-a-scam'])
})

test('S9/S12 resolve bare slugs to real url_paths when a slug index is supplied', () => {
  const b = build({ slugToPath: { 'spot-a-scam': '/guides/spot-a-scam/', 'crypto-scams': '/crypto-scams/' } })
  assert.deepEqual(b.internal_link_targets.node_pages, ['/guides/spot-a-scam/'])
  assert.deepEqual(b.dependencies, ['/crypto-scams/'])
})

test('S9 slug index also accepts a Map; unknown slugs still pass through raw', () => {
  const b = build({ slugToPath: new Map([['crypto-scams', '/crypto-scams/']]) })
  assert.deepEqual(b.dependencies, ['/crypto-scams/'])
  assert.deepEqual(b.internal_link_targets.node_pages, ['spot-a-scam'])
})

test('S12 llms_txt_tier follows node_function', () => {
  assert.equal(build({ topic: { ...TOPIC, node_function: 'authority' } }).llms_txt_tier, 'Core Pages')
  assert.equal(build({ topic: { ...TOPIC, node_function: 'retrieval' } }).llms_txt_tier, 'Reference Data')
  assert.equal(build({ topic: { ...TOPIC, node_function: 'reinforcement' } }).llms_txt_tier, 'Supporting Context')
})

test('S12 versions + dependencies', () => {
  const b = build()
  assert.deepEqual(b.dependencies, ['crypto-scams'])
  assert.equal(b.seo_blog_generator_version, '5.4')
  assert.equal(b.topical_map_version, '4.6')
  assert.equal(b.review_required, true)
})

// ── Robustness ───────────────────────────────────────────────────────────────
test('empty/malformed topic never throws and fabricates nothing', () => {
  for (const bad of [null, undefined, {}, 'nope']) {
    const b = assembleBrief({ topic: bad })
    assert.equal(b.status, 'draft')
    assert.equal(b.entity_wikidata, PLACEHOLDER.UNRESOLVED_QID)
    assert.equal(b.title_tag, PLACEHOLDER.PENDING_LLM)
    assert.deepEqual(b.secondary_keywords, [])
  }
})

test('every template section key is present on the assembled brief', () => {
  const b = build()
  const required = [
    'brief_id', 'created', 'site_url', 'target_url', 'status',
    'section', 'subsection', 'priority', 'node_type', 'fan_out_tag', 'publication_phase', 'publication_order',
    'title_tag', 'url_slug', 'meta_description', 'primary_keyword', 'secondary_keywords', 'search_intent',
    'ymyl', 'word_count_target', 'reading_time_estimate', 'schema_type', 'content_format',
    'locale', 'orthography_notes',
    'content_type', 'forcing_inputs',
    'author_required', 'reviewer_required', 'ymyl_level', 'experience_angle', 'expertise_signals', 'safe_answer_required',
    'central_entity', 'entity_wikidata', 'entity_schema_same_as', 'key_entities', 'related_entities', 'ngram_relations', 'predicates',
    'h1', 'h1_coverage_manifest', 'bluf_target', 'heading_structure', 'faq_sweep', 'anti_mistake',
    'claim_categories', 'passage_independence', 'gen_intent', 'gen_intent_signal', 'key_claim_passages',
    'internal_link_targets', 'outbound_link_targets', 'visual_assets',
    'competitor_pages_to_beat', 'competitor_gap_insight', 'competitor_benchmarks',
    'dependencies', 'review_required', 'compliance_notes', 'llms_txt_tier',
    'seo_blog_generator_version', 'topical_map_version',
  ]
  for (const k of required) assert.ok(k in b, `missing template field: ${k}`)
})
