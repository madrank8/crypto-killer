'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildInvestigation,
  evidenceSnapshotRows,
  investigationSummary,
  daysBetween,
  collectDomainCandidates,
  REQUIRED_FIELDS,
} = require('../lib/investigation-model')

const brand = {
  id: 'b1',
  slug: 'senvix',
  name: 'Senvix',
  scam_score: 47,
  first_seen_at: '2025-09-09T00:00:00Z',
  last_seen_at: '2026-08-13T00:00:00Z',
  lifespan_days: 338,
  total_creatives: 1278,
  total_geos: 18,
  total_celebrities: 136,
  celebrity_list: ['Elon Musk', 'elon  musk', 'Bill Gates'],
  geo_list: ['GB', 'DE', 'FR'],
}
const review = {
  id: 'r1',
  slug: 'senvix',
  scam_score: 56,
  status: 'published',
  published_at: '2026-05-03T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
  author_name: 'M. Webb',
  author_persona_id: 'webb',
  sources: [{ url: 'https://example.org' }],
}

test('days_active is derived from the source dates, not the cached column', () => {
  const i = buildInvestigation({ review, brand })
  assert.equal(i.days_active, daysBetween('2025-09-09', '2026-08-13'))
  assert.equal(i.days_active, 338)
  assert.equal(i.cached_lifespan_days, 338)
})

test('days_active is null when either endpoint is missing', () => {
  assert.equal(buildInvestigation({ review, brand: { ...brand, first_seen_at: null } }).days_active, null)
  assert.equal(buildInvestigation({ review, brand: { ...brand, last_seen_at: null } }).days_active, null)
})

test('impossible chronology yields a negative span rather than being clamped', () => {
  const i = buildInvestigation({ review, brand: { ...brand, first_seen_at: '2026-09-01', last_seen_at: '2026-08-13' } })
  assert.ok(i.days_active < 0, 'the validator has to be able to see this')
})

test('score drift between the investigation and the live brand row is recorded', () => {
  const i = buildInvestigation({ review, brand })
  assert.equal(i.threat_score, 56)
  assert.equal(i.live_brand_score, 47)
  assert.deepEqual(i.score_drift, { investigation: 56, live_brand: 47, delta: -9 })
})

test('no drift is recorded when the two agree', () => {
  const i = buildInvestigation({ review: { ...review, scam_score: 47 }, brand })
  assert.equal(i.score_drift, null)
})

test('the live brand score is used when the investigation has none', () => {
  const i = buildInvestigation({ review: { ...review, scam_score: null }, brand })
  assert.equal(i.threat_score, 47)
  assert.equal(i.score_drift, null)
})

test('public figures dedupe, and a truncated list is marked incomplete', () => {
  const i = buildInvestigation({ review, brand })
  assert.deepEqual(i.public_figures_named, ['Elon Musk', 'Bill Gates'])
  assert.equal(i.public_figure_list_complete, false)
  assert.equal(i.public_figures_impersonated, 136)

  const complete = buildInvestigation({ review, brand: { ...brand, total_celebrities: 2 } })
  assert.equal(complete.public_figure_list_complete, true)
  assert.equal(complete.public_figures_impersonated, 2)
})

test('countries_targeted prefers the actual geo list over the cached count', () => {
  const i = buildInvestigation({ review, brand })
  assert.equal(i.countries_targeted, 3, 'geo_list has 3 entries even though total_geos says 18')
})

test('landing hostnames are offered as candidates, never promoted to primary_domain', () => {
  const i = buildInvestigation({
    review,
    brand,
    landingPages: [{ live_hostname: 'breaking24.novinky-cz.com' }, { live_hostname: 'breaking24.novinky-cz.com' }, { live_url: 'https://www.swisschronicle.click/a' }],
  })
  assert.equal(i.primary_domain, null)
  assert.deepEqual(i.domain_candidates.map((d) => d.hostname), ['breaking24.novinky-cz.com', 'swisschronicle.click'])
  assert.equal(i.domain_candidates[0].observations, 2)
})

test('an analyst-set primary_domain is used verbatim', () => {
  const i = buildInvestigation({ review, brand: { ...brand, primary_domain: 'Senvix.IO' } })
  assert.equal(i.primary_domain, 'senvix.io')
})

test('the snapshot omits fields with no meaningful data', () => {
  const bare = buildInvestigation({
    review: { id: 'r', slug: 's', scam_score: 10, status: 'draft', author_name: 'X' },
    brand: { id: 'b', name: 'Bare', scam_score: 10 },
  })
  const keys = evidenceSnapshotRows(bare).map((r) => r.key)
  assert.ok(!keys.includes('creatives_observed'), 'zero creatives must not render as a "0" row')
  assert.ok(!keys.includes('regulator_warnings'))
  assert.ok(!keys.includes('victim_reports'))
  assert.ok(keys.includes('threat_score'))
})

test('a capped name list is reported as two numbers, never one unbackable headline', () => {
  const row = evidenceSnapshotRows(buildInvestigation({ review, brand })).find((r) => r.key === 'public_figures_impersonated')
  assert.equal(row.value, '136 observed, 2 individually named')
})

test('every snapshot row names the canonical column it came from', () => {
  for (const row of evidenceSnapshotRows(buildInvestigation({ review, brand }))) {
    assert.ok(row.source && row.source.length > 0, `${row.key} has no source`)
  }
})

test('the summary shape exposes exactly the documented fields', () => {
  const s = investigationSummary(buildInvestigation({ review, brand }))
  assert.deepEqual(Object.keys(s).sort(), [
    'brand', 'classification', 'classification_label', 'key_observed_metric',
    'last_checked', 'primary_scam_type', 'score', 'url',
  ])
  assert.equal(s.url, 'https://cryptokiller.org/review/senvix')
  assert.equal(s.key_observed_metric.key, 'creatives_observed')
})

test('required fields are present on a well-formed record', () => {
  const i = buildInvestigation({ review, brand })
  for (const key of REQUIRED_FIELDS) {
    const v = key === 'analyst' ? i.analyst.name : i[key]
    assert.ok(v !== null && v !== undefined && v !== '', `${key} missing`)
  }
})

test('a missing review row is a programmer error, not a silent empty record', () => {
  assert.throws(() => buildInvestigation({}), TypeError)
})

test('domain candidates strip www and lowercase', () => {
  const c = collectDomainCandidates({ landing_urls: ['https://WWW.Example.COM/x'] }, [])
  assert.deepEqual(c, [{ hostname: 'example.com', observations: 1 }])
})

// ── Regressions found in the Fable review pass (2026-08-31) ──────────────

test('REVIEW FIX: a complete list with internal duplicates reports the deduped count', () => {
  // total_celebrities is a raw scraper tally; the stored list is complete but
  // holds a cross-script duplicate. Reporting 3 here is the Floventra bug.
  const i = buildInvestigation({
    review: { id: 'r', slug: 'x', scam_score: 30, author_name: 'A' },
    brand: { id: 'b', name: 'X', scam_score: 30, total_celebrities: 3,
      celebrity_list: ['Mark Zuckerberg', 'Марк Цукерберг', 'Elon Musk'] },
  })
  assert.equal(i.public_figures_impersonated, 2)
  assert.equal(i.public_figure_list_complete, true)
})

test('REVIEW FIX: a truncated list still reports the scraper tally, marked incomplete', () => {
  const i = buildInvestigation({ review, brand }) // total 136, 3 stored
  assert.equal(i.public_figures_impersonated, 136)
  assert.equal(i.public_figure_list_complete, false)
})

test('REVIEW FIX: the review-level override outranks the brand-level one', () => {
  const i = buildInvestigation({
    review: { id: 'r', slug: 'x', scam_score: 70, author_name: 'A',
      classification_override: { classification: 'UNDER_INVESTIGATION', reason: 'source retracted', analyst: 'webb' } },
    brand: { id: 'b', name: 'X', scam_score: 70,
      classification_override: { classification: 'ELEVATED_RISK', reason: 'brand-wide caution', analyst: 'nair' } },
  })
  assert.equal(i.threat_classification, 'UNDER_INVESTIGATION')
})
