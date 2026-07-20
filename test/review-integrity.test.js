const { test } = require('node:test'); const assert = require('node:assert/strict')
const { checkReviewIntegrity, SEVERITY } = require('../lib/review-integrity')

const codes = (r) => r.findings.map((f) => f.code).sort()
const hard = (r) => r.findings.filter((f) => f.severity === SEVERITY.HARD_FAIL).map((f) => f.code)

test('clean review passes', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 95, title: 'Is Quantum AI a Scam? 95/100 Threat Score [2026]', full_article: 'CryptoKiller has investigated {{platform_stat:total_brands_tracked}} scam brands.' },
    brand: { scam_score: 95 },
  })
  assert.equal(r.ok, true)
  assert.equal(r.hardFailReason, null)
})

// ── score drift: the check that caught nothing before ───────────────────────
test('score drift between review and brand is a hard fail, naming both numbers', () => {
  const r = checkReviewIntegrity({ review: { scam_score: 90 }, brand: { scam_score: 95 } })
  assert.equal(r.ok, false)
  assert.ok(hard(r).includes('score_drift'))
  assert.match(r.hardFailReason, /90/)
  assert.match(r.hardFailReason, /95/)
})

test('score drift in EITHER direction is caught', () => {
  assert.equal(checkReviewIntegrity({ review: { scam_score: 14 }, brand: { scam_score: 4 } }).ok, false)
  assert.equal(checkReviewIntegrity({ review: { scam_score: 4 }, brand: { scam_score: 14 } }).ok, false)
})

test('a stale score frozen into the title is caught separately', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 95, title: 'Is Quantum AI a Scam? 90/100 Threat Score [2026]' },
    brand: { scam_score: 95 },
  })
  assert.ok(hard(r).includes('title_score_drift'))
  assert.match(r.hardFailReason, /headline users and search engines see/)
})

test('title without a score is not flagged', () => {
  const r = checkReviewIntegrity({ review: { scam_score: 95, title: 'Is Quantum AI a Scam?' }, brand: { scam_score: 95 } })
  assert.ok(!hard(r).includes('title_score_drift'))
})

// ── hard-coded platform aggregates ──────────────────────────────────────────
test('hard-coded platform figures are caught and quoted back', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'CryptoKiller has investigated 12,384 scam brands.' },
    brand: { scam_score: 5 },
  })
  assert.ok(hard(r).includes('hardcoded_platform_stat'))
  assert.match(r.hardFailReason, /12,384 scam brands/)
})

test('a PER-BRAND creative count is NOT flagged (calibrated on real data)', () => {
  // 29/30 published reviews mention a per-brand creative count; these are real
  // measured facts about that brand, not platform aggregates. Flagging them would
  // make the check noise. Verified against gaspipe-ai (202), kaspi-ai (136),
  // senvix (1,107).
  for (const article of [
    'We captured 202 ad creatives for this brand between March and June.',
    'Our scan surfaced 1,107 ad creatives tied to the operator.',
    'CryptoKiller logged 136 creatives across the campaign.',
  ]) {
    const r = checkReviewIntegrity({ review: { scam_score: 5, full_article: article }, brand: { scam_score: 5 } })
    assert.equal(r.ok, true, `false positive on: ${article}`)
  }
})

test('the exact quantum-ai failure shape is caught', () => {
  const r = checkReviewIntegrity({
    review: {
      scam_score: 90,
      title: 'Is Quantum AI a Scam? 90/100 Threat Score [2026]',
      full_article: 'Our team reviewed creatives in 45 countries. CryptoKiller tracks 12,384 scam brands.',
    },
    brand: { scam_score: 95 },
  })
  assert.equal(r.ok, false)
  // all three independent problems surface, not just the first
  assert.deepEqual(hard(r).sort(), ['hardcoded_platform_stat', 'score_drift', 'title_score_drift'])
})

test('tokenised figures are NOT flagged', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'Across {{platform_stat:total_creatives_analyzed}} ad creatives and {{platform_stat:total_brands_tracked}} catalogued brands.' },
    brand: { scam_score: 5 },
  })
  assert.equal(r.ok, true)
})

test('a country count is flagged — no verified aggregate exists for it', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'Campaigns ran across 49 countries last quarter.' },
    brand: { scam_score: 5 },
  })
  assert.ok(hard(r).includes('hardcoded_platform_stat'))
})

test('an article with no tokens and no platform claims is only a warning', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'CryptoKiller investigated this brand and found withdrawal blocks.' },
    brand: { scam_score: 5 },
  })
  assert.equal(r.ok, true) // warning only, does not block
  assert.ok(codes(r).includes('no_platform_tokens'))
})

// ── robustness ──────────────────────────────────────────────────────────────
test('missing brand or score does not produce a false positive', () => {
  assert.equal(checkReviewIntegrity({ review: { scam_score: 90 }, brand: {} }).ok, true)
  assert.equal(checkReviewIntegrity({ review: {}, brand: { scam_score: 90 } }).ok, true)
  assert.equal(checkReviewIntegrity({}).ok, true)
  assert.equal(checkReviewIntegrity().ok, true)
})

test('malformed input never throws', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.doesNotThrow(() => checkReviewIntegrity({ review: bad, brand: bad }))
  }
})

test('regex state does not leak between calls (global flags reset)', () => {
  const args = {
    review: { scam_score: 5, full_article: 'CryptoKiller tracks 12,384 scam brands.' },
    brand: { scam_score: 5 },
  }
  const a = checkReviewIntegrity(args)
  const b = checkReviewIntegrity(args)
  assert.deepEqual(hard(a), hard(b), 'second call produced a different result')
})
