'use strict'

/**
 * SpyOwl Creative Analytics helpers (catalog volume over a date range).
 * Pure functions: date windows, geo resolve, response normalization.
 */

const RANGE_DAYS = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90,
})

/**
 * Build UTC start/end ISO strings for a preset range or explicit dates.
 * @param {{ range?: string, start?: string, end?: string, now?: Date }} opts
 * @returns {{ start: string, end: string, range: string|null }}
 */
function resolveAnalyticsPeriod(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const explicitStart = (opts.start || '').trim()
  const explicitEnd = (opts.end || '').trim()

  if (explicitStart && explicitEnd) {
    const startMs = Date.parse(explicitStart)
    const endMs = Date.parse(explicitEnd)
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new Error('Invalid start or end date')
    }
    if (startMs >= endMs) {
      throw new Error('start must be before end')
    }
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      range: null,
    }
  }

  const rangeKey = (opts.range || '7d').trim()
  const days = RANGE_DAYS[rangeKey]
  if (!days) {
    throw new Error(`Invalid range (use 7d, 30d, 90d, or start+end)`)
  }

  // Match SpyOwl UI: end = now, start = now - N days (full ISO instants).
  const end = now
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    range: rangeKey,
  }
}

/**
 * Clamp topLimit to [1, max].
 */
function clampTopLimit(raw, max = 50, fallback = 10) {
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, 1), max)
}

/**
 * Build SpyOwl /creative/analytics query string.
 */
function buildAnalyticsQuery({ start, end, topLimit = 10, geoId = null }) {
  const qs = new URLSearchParams({
    start,
    end,
    topLimit: String(topLimit),
  })
  if (geoId) qs.set('geoId', geoId)
  return qs.toString()
}

/**
 * Resolve ISO country code (e.g. IE) to SpyOwl geo region _id.
 * Regions use `name` as the ISO code.
 */
function resolveGeoId(regions, isoCode) {
  const code = String(isoCode || '').trim().toUpperCase()
  if (!code) return null
  const list = Array.isArray(regions) ? regions : []
  const hit = list.find((r) => String(r.name || '').toUpperCase() === code)
  return hit?._id || null
}

/**
 * Map byGeo rows through enabled regions → { code, count, frequencyPercent }.
 */
function mapTopGeos(byGeo, regions) {
  const byId = new Map()
  for (const r of Array.isArray(regions) ? regions : []) {
    if (r && r._id) byId.set(r._id, String(r.name || '').toUpperCase())
  }
  return (Array.isArray(byGeo) ? byGeo : []).map((row) => ({
    geoId: row.geoId,
    code: byId.get(row.geoId) || null,
    count: row.count || 0,
    frequencyPercent: row.frequencyPercent ?? null,
  }))
}

/**
 * Normalize our-DB image/video counts for the selected window.
 * SpyOwl /creative/analytics does not return format; we derive from creatives.is_video.
 *
 * @param {{ video?: number, image?: number, total?: number, unknown?: number }|null} counts
 * @returns {{ video: number, image: number, unknown: number, total: number, videoPercent: number, imagePercent: number, source: string }|null}
 */
function normalizeLocalFormat(counts) {
  if (!counts || typeof counts !== 'object') return null
  const video = Math.max(0, Number(counts.video) || 0)
  const image = Math.max(0, Number(counts.image) || 0)
  const unknown = Math.max(0, Number(counts.unknown) || 0)
  const total =
    counts.total != null
      ? Math.max(0, Number(counts.total) || 0)
      : video + image + unknown
  const denom = total > 0 ? total : 0
  const round1 = (n) => Math.round(n * 10) / 10
  return {
    video,
    image,
    unknown,
    total,
    videoPercent: denom ? round1((video / denom) * 100) : 0,
    imagePercent: denom ? round1((image / denom) * 100) : 0,
    source: 'local_db',
  }
}

/**
 * Normalize raw SpyOwl analytics JSON into the admin API response body.
 */
function normalizeCreativeAnalytics(raw, regions = []) {
  const brands = raw?.brands || {}
  const celebrities = raw?.celebrities || {}
  const pageTypes = raw?.pageTypes || {}
  const catalog = raw?.catalogLaunches || {}
  const byGeo = Array.isArray(raw?.byGeo) ? raw.byGeo : []
  const topGeos = mapTopGeos(byGeo, regions)

  return {
    ok: true,
    source: 'spyowl',
    period: raw?.period || null,
    filters: raw?.filters || { geos: [], geoIds: [] },
    kpis: {
      totalAds: raw?.totalCreatives ?? 0,
      uniqueOffers: brands.totalUnique ?? 0,
      uniqueCelebrities: celebrities.totalUnique ?? 0,
      uniqueGeos: byGeo.length,
      catalog: catalog.catalog ?? 0,
      nonCatalog: catalog.nonCatalog ?? 0,
      land: pageTypes.land ?? 0,
      landAndOffer: pageTypes.landAndOffer ?? 0,
    },
    timeline: Array.isArray(raw?.timeline) ? raw.timeline : [],
    topOffers: Array.isArray(brands.items) ? brands.items : [],
    topCelebrities: Array.isArray(celebrities.items) ? celebrities.items : [],
    topGeos,
    statuses: Array.isArray(raw?.statuses) ? raw.statuses : [],
    catalogLaunches: catalog,
    pageTypes,
  }
}

module.exports = {
  RANGE_DAYS,
  resolveAnalyticsPeriod,
  clampTopLimit,
  buildAnalyticsQuery,
  resolveGeoId,
  mapTopGeos,
  normalizeLocalFormat,
  normalizeCreativeAnalytics,
}
