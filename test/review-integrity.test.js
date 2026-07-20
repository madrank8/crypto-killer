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
test('platform-scale figures still need a platform token', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'CryptoKiller has investigated 12,384 scam brands.' },
    brand: { scam_score: 5 },
  })
  assert.ok(hard(r).includes('hardcoded_platform_stat'))
  assert.match(r.hardFailReason, /12,384 scam brands/)
})

// ── per-brand stat drift — the real shape of the problem ────────────────────
test('a per-brand stat that DRIFTED from the brand row is a hard fail naming the token', () => {
  // senvix really says 1,107 while the brand row now holds 1,248.
  const r = checkReviewIntegrity({
    review: { scam_score: 55, full_article: 'Our scan surfaced 1,107 ad creatives tied to the operator.' },
    brand: { scam_score: 55, total_creatives: 1248 },
  })
  assert.ok(hard(r).includes('brand_stat_drift'))
  assert.match(r.hardFailReason, /1,107 ad creatives/)
  assert.match(r.hardFailReason, /1248/)
  assert.match(r.hardFailReason, /\{\{stat:ad_creatives\}\}/)
})

test('a per-brand stat that still MATCHES is only a warning (correct today, fragile tomorrow)', () => {
  // kaspi-ai's 136 currently matches its brand row.
  const r = checkReviewIntegrity({
    review: { scam_score: 18, full_article: 'CryptoKiller logged 136 ad creatives across the campaign.' },
    brand: { scam_score: 18, total_creatives: 136 },
  })
  assert.equal(r.ok, true, 'a matching literal must not block')
  assert.ok(codes(r).includes('brand_stat_literal'))
  assert.match(r.findings.find((f) => f.code === 'brand_stat_literal').message, /will drift/)
})

test('countries and celebrities drift too, each naming their own token', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 95, full_article: 'Campaigns ran in 45 countries with 56 celebrities impersonated.' },
    brand: { scam_score: 95, total_geos: 49, total_celebrities: 353 },
  })
  assert.equal(hard(r).filter((c) => c === 'brand_stat_drift').length, 2)
  assert.match(r.hardFailReason, /\{\{stat:countries_targeted\}\}/)
  assert.match(r.hardFailReason, /\{\{stat:celebrities_abused\}\}/)
})

test('no brand data for a stat -> no finding (never guess)', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'We saw 202 ad creatives in 7 countries.' },
    brand: { scam_score: 5 },
  })
  assert.equal(r.ok, true)
  assert.ok(!codes(r).includes('brand_stat_drift'))
})

test('the exact quantum-ai failure shape is caught', () => {
  const r = checkReviewIntegrity({
    review: {
      scam_score: 90,
      title: 'Is Quantum AI a Scam? 90/100 Threat Score [2026]',
      full_article: 'We reviewed 3,000+ ad creatives in 45 countries, with 56 celebrities impersonated.',
    },
    brand: { scam_score: 95, total_creatives: 4813, total_geos: 49, total_celebrities: 353 },
  })
  assert.equal(r.ok, false)
  // every independent problem surfaces, not just the first
  assert.equal(hard(r).filter((c) => c === 'brand_stat_drift').length, 3)
  assert.ok(hard(r).includes('score_drift'))
  assert.ok(hard(r).includes('title_score_drift'))
})

test('tokenised figures are NOT flagged', () => {
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'Across {{platform_stat:total_creatives_analyzed}} ad creatives and {{platform_stat:total_brands_tracked}} catalogued brands.' },
    brand: { scam_score: 5 },
  })
  assert.equal(r.ok, true)
})

test('an article making no numeric claims produces no findings', () => {
  // The old vague "no tokens present" warning was removed: it fired on articles
  // that legitimately make no platform claims. The drift checks are precise, so a
  // catch-all suspicion is just noise operators learn to skip.
  const r = checkReviewIntegrity({
    review: { scam_score: 5, full_article: 'CryptoKiller investigated this brand and found withdrawal blocks.' },
    brand: { scam_score: 5, total_creatives: 200 },
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.findings, [])
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
