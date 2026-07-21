const { test } = require('node:test'); const assert = require('node:assert/strict')
const { tokenizeBrandStats, correctScoreLiterals, planReviewBackfill } = require('../lib/review-stat-tokenizer')

// ── tokenizeBrandStats: the surgical part ───────────────────────────────────
test('replaces the NUMBER only, preserving the noun and surrounding prose exactly', () => {
  const { text, replacements } = tokenizeBrandStats(
    'We captured 3,000+ ad creatives tied to this operator across the campaign.',
    { total_creatives: 4813 }
  )
  assert.equal(text, 'We captured {{stat:ad_creatives}} ad creatives tied to this operator across the campaign.')
  assert.deepEqual(replacements, [{ field: 'total_creatives', from: '3,000+', token: '{{stat:ad_creatives}}', current: 4813 }])
})

test('all three per-brand stats tokenise with their own token', () => {
  const { text } = tokenizeBrandStats(
    'Ran 45 countries, impersonated 56 celebrities, using 202 ad creatives.',
    { total_geos: 49, total_celebrities: 353, total_creatives: 204 }
  )
  assert.match(text, /\{\{stat:countries_targeted\}\} countries/)
  assert.match(text, /\{\{stat:celebrities_abused\}\} celebrities/)
  assert.match(text, /\{\{stat:ad_creatives\}\} ad creatives/)
  assert.ok(!/\b(45|56|202)\b/.test(text), 'a literal survived')
})

test('NEVER introduces a token the brand row cannot back', () => {
  // brand has no total_geos → the "45 countries" literal is left untouched.
  const { text, replacements } = tokenizeBrandStats('Ran 45 countries with 202 ad creatives.', { total_creatives: 204 })
  assert.match(text, /45 countries/)
  assert.match(text, /\{\{stat:ad_creatives\}\}/)
  assert.deepEqual(replacements.map((r) => r.field), ['total_creatives'])
})

test('does NOT touch numbers that are not stats', () => {
  const article = 'The minimum deposit is $50,000. Victims lost £3,200 on average. Support replied in 72 hours. We list 8 red flags below.'
  const { text, replacements } = tokenizeBrandStats(article, { total_creatives: 204, total_geos: 5, total_celebrities: 4 })
  assert.equal(text, article, 'a non-stat number was altered')
  assert.deepEqual(replacements, [])
})

test('replaces EVERY occurrence, so the article is fully self-healing', () => {
  const { text } = tokenizeBrandStats(
    'We logged 202 ad creatives. Those 202 creatives ran for months.',
    { total_creatives: 204 }
  )
  assert.ok(!/202/.test(text))
  assert.equal((text.match(/\{\{stat:ad_creatives\}\}/g) || []).length, 2)
})

test('idempotent: running twice does not double-tokenise', () => {
  const once = tokenizeBrandStats('Used 202 ad creatives.', { total_creatives: 204 }).text
  const twice = tokenizeBrandStats(once, { total_creatives: 204 }).text
  assert.equal(once, twice)
})

test('malformed input never throws', () => {
  for (const [a, b] of [[null, {}], [undefined, null], [42, {}], ['', {}]]) {
    assert.doesNotThrow(() => tokenizeBrandStats(a, b))
  }
})

// ── correctScoreLiterals: precise, context-free ─────────────────────────────
test('corrects only the OLD score /100, leaving unrelated /100 alone', () => {
  const { text, count } = correctScoreLiterals('Threat Score 90/100. Trustpilot rated it 45/100 separately.', 90, 95)
  assert.equal(text, 'Threat Score 95/100. Trustpilot rated it 45/100 separately.')
  assert.equal(count, 1)
})

test('handles flexible whitespace around the slash', () => {
  assert.equal(correctScoreLiterals('scored 90 / 100', 90, 95).text, 'scored 95 / 100')
})

test('no change when scores already match or inputs are bad', () => {
  assert.equal(correctScoreLiterals('90/100', 90, 90).count, 0)
  assert.equal(correctScoreLiterals('90/100', null, 95).count, 0)
  assert.equal(correctScoreLiterals(null, 90, 95).text, '')
})

// ── planReviewBackfill: the full per-review plan ────────────────────────────
const QUANTUM = {
  review: {
    scam_score: 90,
    title: 'Is Quantum AI a Scam? 90/100 Threat Score [2026]',
    full_article: 'Quantum AI scores 90/100. We reviewed 3,000+ ad creatives across 45 countries, with 56 celebrities impersonated.',
  },
  brand: { scam_score: 95, total_creatives: 4813, total_geos: 49, total_celebrities: 353 },
}

test('the quantum-ai plan fixes every dimension and reports each', () => {
  const { changed, patch, report } = planReviewBackfill(QUANTUM.review, QUANTUM.brand)
  assert.equal(changed, true)
  // score column
  assert.equal(patch.scam_score, 95)
  assert.deepEqual(report.score_column, { from: 90, to: 95 })
  // title score
  assert.match(patch.title, /95\/100/)
  assert.ok(!/90\/100/.test(patch.title))
  assert.equal(report.score_corrections.title, 1)
  // body: stats tokenised + score corrected
  assert.match(patch.full_article, /\{\{stat:ad_creatives\}\}/)
  assert.match(patch.full_article, /\{\{stat:countries_targeted\}\}/)
  assert.match(patch.full_article, /\{\{stat:celebrities_abused\}\}/)
  assert.match(patch.full_article, /95\/100/)
  assert.ok(!/90\/100/.test(patch.full_article))
  assert.ok(!/3,000|45 countries|56 celebrities/.test(patch.full_article))
  assert.equal(report.tokenized.length, 3)
  assert.equal(report.score_corrections.body, 1)
})

test('a clean review yields no patch', () => {
  const { changed, patch } = planReviewBackfill(
    { scam_score: 95, title: 'Is X a Scam? 95/100', full_article: 'Used {{stat:ad_creatives}} ad creatives.' },
    { scam_score: 95, total_creatives: 4813 }
  )
  assert.equal(changed, false)
  assert.deepEqual(patch, {})
})

test('only changed fields appear in the patch', () => {
  // score already correct, but body has a drifted stat → only full_article changes
  const { patch } = planReviewBackfill(
    { scam_score: 95, title: 'Is X a Scam? 95/100', full_article: 'Used 202 ad creatives.' },
    { scam_score: 95, total_creatives: 204 }
  )
  assert.deepEqual(Object.keys(patch), ['full_article'])
})

test('planReviewBackfill never throws on malformed input', () => {
  for (const [r, b] of [[null, null], [{}, {}], ['x', 42]]) {
    assert.doesNotThrow(() => planReviewBackfill(r, b))
  }
})
