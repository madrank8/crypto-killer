'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  resolveAnalyticsPeriod,
  clampTopLimit,
  buildAnalyticsQuery,
  resolveGeoId,
  mapTopGeos,
  normalizeCreativeAnalytics,
  normalizeLocalFormat,
} = require('../lib/creative-analytics')

test('resolveAnalyticsPeriod builds 7d window from now', () => {
  const now = new Date('2026-08-01T12:00:00.000Z')
  const p = resolveAnalyticsPeriod({ range: '7d', now })
  assert.equal(p.range, '7d')
  assert.equal(p.end, '2026-08-01T12:00:00.000Z')
  assert.equal(p.start, '2026-07-25T12:00:00.000Z')
})

test('resolveAnalyticsPeriod accepts explicit start/end', () => {
  const p = resolveAnalyticsPeriod({
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-07-08T00:00:00.000Z',
  })
  assert.equal(p.range, null)
  assert.equal(p.start, '2026-07-01T00:00:00.000Z')
  assert.equal(p.end, '2026-07-08T00:00:00.000Z')
})

test('resolveAnalyticsPeriod rejects invalid range and inverted dates', () => {
  assert.throws(() => resolveAnalyticsPeriod({ range: '1d' }), /Invalid range/)
  assert.throws(
    () =>
      resolveAnalyticsPeriod({
        start: '2026-07-10T00:00:00.000Z',
        end: '2026-07-01T00:00:00.000Z',
      }),
    /start must be before end/
  )
})

test('clampTopLimit bounds and defaults', () => {
  assert.equal(clampTopLimit(undefined), 10)
  assert.equal(clampTopLimit('3'), 3)
  assert.equal(clampTopLimit('0'), 1)
  assert.equal(clampTopLimit('99'), 50)
  assert.equal(clampTopLimit('nope'), 10)
})

test('buildAnalyticsQuery includes geoId when set', () => {
  const qs = buildAnalyticsQuery({
    start: '2026-07-25T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
    topLimit: 10,
    geoId: 'abc123',
  })
  const params = new URLSearchParams(qs)
  assert.equal(params.get('start'), '2026-07-25T00:00:00.000Z')
  assert.equal(params.get('end'), '2026-08-01T00:00:00.000Z')
  assert.equal(params.get('topLimit'), '10')
  assert.equal(params.get('geoId'), 'abc123')
})

test('buildAnalyticsQuery omits geoId when null', () => {
  const qs = buildAnalyticsQuery({
    start: 'a',
    end: 'b',
    topLimit: 5,
  })
  assert.equal(new URLSearchParams(qs).has('geoId'), false)
})

test('resolveGeoId maps ISO code via region name', () => {
  const regions = [
    { _id: 'id-ad', name: 'AD' },
    { _id: 'id-ie', name: 'IE' },
  ]
  assert.equal(resolveGeoId(regions, 'ie'), 'id-ie')
  assert.equal(resolveGeoId(regions, 'IE'), 'id-ie')
  assert.equal(resolveGeoId(regions, 'XX'), null)
  assert.equal(resolveGeoId(regions, ''), null)
})

test('normalizeCreativeAnalytics maps KPIs and top geos', () => {
  const raw = {
    period: { start: 'a', end: 'b' },
    filters: { geos: [], geoIds: [] },
    totalCreatives: 974,
    pageTypes: { land: 521, landAndOffer: 453 },
    statuses: [{ status: 'APPROVED', count: 972, frequencyPercent: 99.79 }],
    catalogLaunches: {
      catalog: 382,
      nonCatalog: 592,
      total: 974,
    },
    celebrities: {
      totalUnique: 322,
      items: [{ name: 'Celeb A', count: 40, frequencyPercent: 4.1 }],
    },
    brands: {
      totalUnique: 265,
      items: [{ name: 'Quantum AI', count: 89, frequencyPercent: 9.14 }],
    },
    timeline: [{ date: '2026-07-28', totalCreatives: 100, land: 50, landAndOffer: 50 }],
    byGeo: [
      { geoId: 'id-ie', count: 83, frequencyPercent: 8.5 },
      { geoId: 'unknown', count: 1, frequencyPercent: 0.1 },
    ],
    topByGeo: [],
  }
  const regions = [
    { _id: 'id-ie', name: 'IE' },
    { _id: 'id-fr', name: 'FR' },
  ]

  const out = normalizeCreativeAnalytics(raw, regions)
  assert.equal(out.ok, true)
  assert.equal(out.source, 'spyowl')
  assert.equal(out.kpis.totalAds, 974)
  assert.equal(out.kpis.uniqueOffers, 265)
  assert.equal(out.kpis.uniqueCelebrities, 322)
  assert.equal(out.kpis.uniqueGeos, 2)
  assert.equal(out.kpis.catalog, 382)
  assert.equal(out.kpis.land, 521)
  assert.equal(out.topOffers[0].name, 'Quantum AI')
  assert.equal(out.topCelebrities[0].name, 'Celeb A')
  assert.equal(out.timeline.length, 1)
  assert.deepEqual(out.topGeos[0], {
    geoId: 'id-ie',
    code: 'IE',
    count: 83,
    frequencyPercent: 8.5,
  })
  assert.equal(out.topGeos[1].code, null)
})

test('mapTopGeos handles empty inputs', () => {
  assert.deepEqual(mapTopGeos(null, null), [])
  assert.deepEqual(mapTopGeos([], []), [])
})

test('normalizeLocalFormat computes image/video percents', () => {
  const out = normalizeLocalFormat({ video: 25, image: 75, total: 100 })
  assert.equal(out.source, 'local_db')
  assert.equal(out.video, 25)
  assert.equal(out.image, 75)
  assert.equal(out.videoPercent, 25)
  assert.equal(out.imagePercent, 75)
  assert.equal(out.unknown, 0)
})

test('normalizeLocalFormat tracks unknown and zero totals', () => {
  const withUnknown = normalizeLocalFormat({ video: 10, image: 80, unknown: 10, total: 100 })
  assert.equal(withUnknown.unknown, 10)
  assert.equal(withUnknown.imagePercent, 80)
  assert.equal(withUnknown.videoPercent, 10)

  const empty = normalizeLocalFormat({ video: 0, image: 0, total: 0 })
  assert.equal(empty.videoPercent, 0)
  assert.equal(empty.imagePercent, 0)

  assert.equal(normalizeLocalFormat(null), null)
})
