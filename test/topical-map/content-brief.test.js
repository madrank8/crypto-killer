const { test } = require('node:test'); const assert = require('node:assert/strict')
const { buildContentBrief, formatBriefForPrompt } = require('../../lib/topical-map/content-brief')

const FULL = {
  title: 'Stake.us Review', target_keyword: 'stake us review', url_path: '/casino-reviews/stake-us/',
  slug: 'stake-us', topic_type: 'brand_review', section: 'core', page_role: 'Core',
  node_type: 'standard', node_function: 'entity', search_intent: 'commercial',
  secondary_keywords: ['stake us legit', 'stake us scam'], macro_vector: 'stake.us safety',
  content_format: 'Comparison Table', format_code: 'COMP', schema_type: 'Review',
  paa_questions: ['Is Stake.us legit?', 'Is Stake.us a scam?'], aio_risk: 80,
  internal_links_to: ['/guides/spot-a-scam'], priority_score: 72,
}

// ── buildContentBrief ─────────────────────────────────────────────────────────
test('brief: full topic projects every section', () => {
  const b = buildContentBrief(FULL, { parentTopic: { title: 'Casino Reviews' } })
  assert.equal(b.identity.raw_topic, 'Stake.us Review')
  assert.equal(b.identity.url_path, '/casino-reviews/stake-us/')
  assert.equal(b.placement.node_function, 'entity')
  assert.equal(b.placement.parent, 'Casino Reviews')
  assert.deepEqual(b.targeting.secondary_keywords, ['stake us legit', 'stake us scam'])
  assert.equal(b.production.content_format, 'Comparison Table')
  assert.equal(b.production.schema_type, 'Review')
  assert.deepEqual(b.heading_seeds, ['Is Stake.us legit?', 'Is Stake.us a scam?'])
  assert.match(b.aio_directive, /high/)
  assert.deepEqual(b.internal_link_targets, ['/guides/spot-a-scam'])
  assert.equal(b.priority_score, 72)
})

test('brief: url_path preferred over slug; slug used only when no url_path', () => {
  assert.equal(buildContentBrief({ title: 'X', url_path: '/a/', slug: 's' }).identity.url_path, '/a/')
  const b = buildContentBrief({ title: 'X', slug: 's' })
  assert.equal(b.identity.slug, 's')
  assert.equal(b.identity.url_path, undefined)
})

test('brief: sparse topic omits empty sections (no fabrication)', () => {
  const b = buildContentBrief({ title: 'Bare', target_keyword: 'bare' })
  assert.deepEqual(Object.keys(b), ['identity'])
  assert.equal(b.placement, undefined)
  assert.equal(b.production, undefined)
  assert.equal(b.heading_seeds, undefined)
  assert.equal(b.aio_directive, undefined)
})

test('brief: empty/invalid topic never throws, returns {}', () => {
  assert.deepEqual(buildContentBrief(null), {})
  assert.deepEqual(buildContentBrief(undefined), {})
  assert.deepEqual(buildContentBrief({}), {})
  assert.deepEqual(buildContentBrief({ secondary_keywords: [], paa_questions: [] }), {})
})

test('brief: parentTopic absent -> no parent key', () => {
  const b = buildContentBrief({ title: 'X', topic_type: 'cluster' })
  assert.equal(b.placement.parent, undefined)
  assert.equal(b.placement.topic_type, 'cluster')
})

test('brief: aio_risk levels and label passthrough', () => {
  assert.match(buildContentBrief({ title: 'x', aio_risk: 80 }).aio_directive, /high/)
  assert.match(buildContentBrief({ title: 'x', aio_risk: 50 }).aio_directive, /medium/)
  assert.match(buildContentBrief({ title: 'x', aio_risk: 10 }).aio_directive, /low/)
  assert.match(buildContentBrief({ title: 'x', aio_risk: 'high' }).aio_directive, /high/)
  assert.equal(buildContentBrief({ title: 'x' }).aio_directive, undefined) // no risk -> no directive
})

test('brief: non-array list fields are omitted, never crash (.join guard)', () => {
  // jsonb columns could hold a bare string / garbage — must not throw, must omit.
  assert.doesNotThrow(() => buildContentBrief({ title: 'x', secondary_keywords: 'not-an-array', paa_questions: 'one q', internal_links_to: 42 }))
  const b = buildContentBrief({ title: 'x', secondary_keywords: 'not-an-array', paa_questions: 'one q', internal_links_to: 42 })
  assert.equal(b.targeting, undefined)
  assert.equal(b.heading_seeds, undefined)
  assert.equal(b.internal_link_targets, undefined)
})

test('brief: blank/null array entries are filtered out (no junk directives)', () => {
  const b = buildContentBrief({ title: 'x', secondary_keywords: ['kw one', '', '  ', null, 'kw two'], paa_questions: ['', 'Real question?'] })
  assert.deepEqual(b.targeting.secondary_keywords, ['kw one', 'kw two'])
  assert.deepEqual(b.heading_seeds, ['Real question?'])
})

test('brief: an all-blank array is omitted entirely', () => {
  assert.equal(buildContentBrief({ title: 'x', secondary_keywords: ['', '  ', null] }).targeting, undefined)
})

test('prompt block: non-array list fields do not throw and render nothing for those lines', () => {
  assert.doesNotThrow(() => formatBriefForPrompt({ title: 'x', secondary_keywords: 'nope', paa_questions: 'nope' }))
  assert.equal(formatBriefForPrompt({ title: 'x', secondary_keywords: 'nope', paa_questions: 'nope' }), '')
})

// ── Entity map (Step 21) ──────────────────────────────────────────────────────
test('entity: a registry hit resolves with a real Q-ID and sameAs', () => {
  const b = buildContentBrief({ title: 'What the FTC says', target_keyword: 'ftc' })
  assert.equal(b.entity.name, 'Federal Trade Commission')
  assert.equal(b.entity.wikidata_qid, 'Q465381')
  assert.ok(b.entity.same_as.some((u) => u.includes('wikidata.org/wiki/Q465381')))
  assert.ok(b.entity.same_as.some((u) => u.includes('wikipedia.org')))
})

test('entity: a registry MISS omits the entity entirely (never fabricates a Q-ID)', () => {
  const b = buildContentBrief({ title: 'Totally Unknown Scam Brand XYZ', target_keyword: 'totally unknown scam brand xyz' })
  assert.equal(b.entity, undefined) // honesty rule: unresolved > fabricated
})

test('entity: qid_override wins over a property-id qid (never publish a P-id as verified)', () => {
  // registry `bbb` carries qid 'P902' (a Wikidata PROPERTY id) + qid_override 'Q806097'.
  const b = buildContentBrief({ title: 'Better Business Bureau', target_keyword: 'better business bureau' })
  assert.equal(b.entity.wikidata_qid, 'Q806097')
  assert.ok(!String(b.entity.wikidata_qid).startsWith('P'))
  // and it must agree with the sameAs it ships alongside
  assert.ok(b.entity.same_as.some((u) => u.includes('Q806097')))
})

test('entity: falls back from target_keyword to title', () => {
  const b = buildContentBrief({ title: 'fbi', target_keyword: 'no-such-entity-here' })
  assert.equal(b.entity.wikidata_qid, 'Q8333')
})

test('entity: missing title/keyword never throws', () => {
  assert.doesNotThrow(() => buildContentBrief({}))
  assert.equal(buildContentBrief({}).entity, undefined)
})

test('prompt block: a resolved entity renders verified identifiers only', () => {
  const s = formatBriefForPrompt({ title: 'x', target_keyword: 'ftc' })
  assert.match(s, /PRIMARY ENTITY: Federal Trade Commission/)
  assert.match(s, /Wikidata Q465381/)
  assert.match(s, /never invent other identifiers/)
})

test('prompt block: an unresolved entity contributes no line', () => {
  assert.equal(formatBriefForPrompt({ title: 'Unknown Brand Zzz', target_keyword: 'unknown brand zzz' }), '')
})

// ── formatBriefForPrompt ──────────────────────────────────────────────────────
test('prompt block: renders directives for a full topic', () => {
  const s = formatBriefForPrompt(FULL, { parentTopic: { title: 'Casino Reviews' } })
  assert.match(s, /TOPICAL MAP BRIEF/)
  assert.match(s, /TARGET FORMAT: Comparison Table \(COMP\)/)
  assert.match(s, /SCHEMA TARGET: Review/)
  assert.match(s, /function=entity/)
  assert.match(s, /People-Also-Ask.*Is Stake\.us legit\?/)
  assert.match(s, /CANONICAL URL PATH: \/casino-reviews\/stake-us\//)
})

test('prompt block: empty when no directive-bearing fields', () => {
  assert.equal(formatBriefForPrompt({ title: 'Bare', target_keyword: 'bare' }), '')
  assert.equal(formatBriefForPrompt(null), '')
  assert.equal(formatBriefForPrompt({}), '')
})

test('prompt block: identity-only url still yields a URL directive', () => {
  const s = formatBriefForPrompt({ title: 'X', url_path: '/a/b/' })
  assert.match(s, /CANONICAL URL PATH: \/a\/b\//)
})
