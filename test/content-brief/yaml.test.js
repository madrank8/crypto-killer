const { test } = require('node:test'); const assert = require('node:assert/strict')
const YAML = require('yaml')
const { PLACEHOLDER, assembleBrief } = require('../../lib/content-brief/assemble')
const { mergeEnrichment } = require('../../lib/content-brief/enrich')
const { toYaml, SECTIONS, needsQuote } = require('../../lib/content-brief/yaml')

const TOPIC = {
  title: 'How Rug Pulls Work', slug: 'how-rug-pulls-work', url_path: '/crypto-scams/rug-pulls/',
  target_keyword: 'how rug pulls work', secondary_keywords: ['rug pull signs'],
  section: 'core', topic_type: 'cluster', node_type: 'standard', node_function: 'reinforcement',
  priority_score: 75, search_intent: 'informational', content_format: 'Evergreen Article',
  schema_type: 'Article', paa_questions: ['What is a rug pull?', 'How do I spot one?'],
  serp_features: ['ai_overview'], serp_authority: { dr_median: 55 },
  competitor_urls: ['https://rival.com/rug-pulls'],
  internal_links_to: ['spot-a-scam'], dependencies: ['crypto-scams'],
}
const SULLIVAN = {
  content_type: 'firsthand_review',
  forcing_inputs: {
    direct_anecdotes: ['Saw the withdrawal block', 'Support went silent', 'Domain rotated twice'],
    field_observation_count: '400 callouts since 2019',
    recurring_pattern: 'Liquidity pulled within 72h of launch',
    credentials: 'Lead investigator, 6 years',
  },
}
const brief = () => assembleBrief({
  topic: TOPIC, parentTopic: { title: 'Crypto Scams', url_path: '/crypto-scams/' },
  siteUrl: 'https://cryptokiller.org', created: '2026-07-19', sullivan: SULLIVAN,
  publication: { week: 2, target_date: '2026-07-27', order: 3 },
})
const roundTrip = (b) => YAML.parse(toYaml(b))

// ── The thing that would silently corrupt the handoff ────────────────────────
test('honesty placeholders survive a real YAML round-trip as STRINGS', () => {
  const parsed = roundTrip(brief())
  // Bare, "[NO DATA — …]" would parse as a flow sequence and destroy the marker.
  assert.equal(typeof parsed.title_tag, 'string')
  assert.equal(parsed.title_tag, PLACEHOLDER.PENDING_LLM)
  assert.equal(parsed.entity_wikidata, PLACEHOLDER.UNRESOLVED_QID)
  assert.deepEqual(parsed.claim_categories.competitor_benchmarks, [PLACEHOLDER.NO_DATA])
  assert.equal(parsed.competitor_benchmarks.word_count, PLACEHOLDER.NO_DATA)
  for (const v of [parsed.title_tag, parsed.entity_wikidata]) assert.ok(!Array.isArray(v))
})

test('every emitted brief is valid YAML that parses without throwing', () => {
  assert.doesNotThrow(() => YAML.parse(toYaml(brief())))
  assert.doesNotThrow(() => YAML.parse(toYaml({})))
  assert.doesNotThrow(() => YAML.parse(toYaml(null)))
})

test('needsQuote flags every leading-bracket placeholder', () => {
  for (const p of Object.values(PLACEHOLDER)) assert.equal(needsQuote(p), true, p)
})

// ── Round-trip fidelity of real content ─────────────────────────────────────
test('scalars, booleans and numbers keep their types through the round-trip', () => {
  const parsed = roundTrip(brief())
  assert.equal(parsed.status, 'draft')
  assert.equal(parsed.ymyl, true)
  assert.equal(parsed.review_required, true)
  assert.equal(parsed.word_count_target, 2500)
  assert.equal(parsed.publication_order, 3)
  assert.equal(parsed.primary_keyword, 'how rug pulls work')
})

test('human-supplied Sullivan evidence survives verbatim', () => {
  const parsed = roundTrip(brief())
  assert.equal(parsed.content_type, 'firsthand_review')
  assert.deepEqual(parsed.forcing_inputs.direct_anecdotes, SULLIVAN.forcing_inputs.direct_anecdotes)
  assert.equal(parsed.forcing_inputs.field_observation_count, '400 callouts since 2019')
})

test('measured data survives: competitor URLs, SERP features, PAA-seeded headings', () => {
  const parsed = roundTrip(brief())
  assert.deepEqual(parsed.competitor_pages_to_beat, ['https://rival.com/rug-pulls'])
  assert.deepEqual(parsed.competitor_benchmarks.serp_features, ['ai_overview'])
  const h2s = parsed.heading_structure.map((h) => h.h2)
  assert.ok(h2s.includes('What is a rug pull?'))
  assert.ok(h2s.some((h) => /NOT the Right Choice/.test(h)))
})

test('nested structures round-trip: internal links, claim categories, headings', () => {
  const parsed = roundTrip(brief())
  assert.equal(parsed.internal_link_targets.root, '/')
  assert.deepEqual(parsed.internal_link_targets.seed_pages, ['/crypto-scams/'])
  assert.equal(typeof parsed.claim_categories, 'object')
  assert.ok(Array.isArray(parsed.heading_structure))
  assert.equal(parsed.heading_structure[0].heading_level, 'H2')
})

// ── Export hygiene ──────────────────────────────────────────────────────────
test('internal bookkeeping keys are stripped from the handoff', () => {
  const y = toYaml(brief())
  assert.ok(!y.includes('_seed_source'), '_seed_source leaked into export')
  assert.ok(!y.includes('_mandatory'), '_mandatory leaked into export')
  const parsed = YAML.parse(y)
  for (const h of parsed.heading_structure) {
    assert.equal(h._seed_source, undefined)
    assert.equal(h._mandatory, undefined)
  }
})

test('section order follows brief-template.md, not object key order', () => {
  const y = toYaml(brief())
  const positions = SECTIONS.map((s) => y.indexOf(s.title)).filter((i) => i !== -1)
  const sorted = [...positions].sort((a, b) => a - b)
  assert.deepEqual(positions, sorted, 'sections emitted out of template order')
  assert.ok(y.indexOf('SECTION 1: IDENTITY') < y.indexOf('SECTION 12'))
})

test('the header explains what the bracketed markers mean', () => {
  const y = toYaml(brief())
  assert.match(y, /HONESTY MARKERS/)
  assert.match(y, /\[UNVERIFIED …\]/)
})

test('absent fields are skipped rather than emitted as null noise', () => {
  const y = toYaml({ brief_id: 'cbr-x-2026-07-19', status: 'draft' })
  assert.match(y, /brief_id: cbr-x-2026-07-19/)
  assert.ok(!y.includes('title_tag'))
  assert.ok(!y.includes('SECTION 10'))
})

test('YAML-hostile scalars all round-trip (the quoting contract)', () => {
  const cases = {
    reading_time_estimate: '~11 min',        // ~ is YAML null
    search_intent: 'I + GEN',
    fan_out_tag: '',                          // empty string, not null
    title_tag: '@handle mention',             // @ is reserved
    meta_description: '100% of cases & more',
    primary_keyword: '*emphasis*',            // * is an alias indicator
    h1: 'Rug pulls: the playbook',            // colon
    bluf_target: 'the #1 sign',               // # is a comment
    central_entity: '- leading dash',         // looks like a list item
    subsection: '? leading question',         // ? is a complex-key indicator
    brief_id: '2024',                         // must stay a string, not a number
    status: 'yes',                            // must stay a string, not a boolean
    compliance_notes: '~',                    // bare null indicator
    competitor_gap_insight: 'He said "go" and left',
    entity_wikidata: '[NO DATA — requires Tool-Assisted mode]',
  }
  const parsed = YAML.parse(toYaml(cases))
  for (const [k, v] of Object.entries(cases)) {
    assert.equal(parsed[k], v, `${k} did not survive: ${JSON.stringify(parsed[k])}`)
  }
})

test('long and multiline prose survive as folded block scalars', () => {
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim()
  const parsed = YAML.parse(toYaml({
    h1_coverage_manifest: 'line one\nline two',
    author_required: 'x'.repeat(150),
  }))
  assert.equal(norm(parsed.h1_coverage_manifest), 'line one line two')
  assert.equal(norm(parsed.author_required), 'x'.repeat(150))
})

// ── Enriched brief also exports cleanly ─────────────────────────────────────
test('an enriched brief round-trips with its guarded values intact', () => {
  const { brief: enrichedBrief } = mergeEnrichment(brief(), {
    title_tag: 'How Rug Pulls Work: The Exit-Scam Playbook',
    bluf_target: 'A rug pull is a token exit scam in which developers drain the liquidity pool after hype peaks, leaving holders unable to sell.',
    predicates: ['Rug pull drains the liquidity pool', 'Developers renounce then re-mint'],
    claim_categories: { regulatory_status: ['SEC enforcement posture on token launches'] },
    visual_assets: [{ type: 'diagram', description: 'Liquidity drain timeline', alt_text: 'Rug pull timeline', placement: 'after How do I spot one?' }],
  })
  const parsed = roundTrip(enrichedBrief)
  assert.equal(parsed.title_tag, 'How Rug Pulls Work: The Exit-Scam Playbook')
  assert.match(parsed.bluf_target, /token exit scam/)
  assert.deepEqual(parsed.predicates, ['Rug pull drains the liquidity pool', 'Developers renounce then re-mint'])
  assert.equal(parsed.visual_assets[0].type, 'diagram')
  assert.equal(parsed.visual_assets[0].placement, 'after How do I spot one?')
  // the guard still holds through export
  assert.deepEqual(parsed.claim_categories.competitor_benchmarks, [PLACEHOLDER.NO_DATA])
})

test('strings containing YAML-significant characters survive', () => {
  const { brief: b } = mergeEnrichment(brief(), {
    meta_description: 'Rug pulls: how they work, why they succeed — and the #1 warning sign.',
    competitor_gap_insight: 'Rivals cover "what is a rug pull" but never the recovery path.',
  })
  const parsed = roundTrip(b)
  assert.equal(parsed.meta_description, 'Rug pulls: how they work, why they succeed — and the #1 warning sign.')
  assert.equal(parsed.competitor_gap_insight, 'Rivals cover "what is a rug pull" but never the recovery path.')
})
