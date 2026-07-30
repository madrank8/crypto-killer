import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { getSpyOwlCookie, fetchEnabledGeoRegions, fetchCreativeAnalytics, isAuthFailureMessage } from '@/lib/scraper'
import { supaFetch } from '@/lib/supabase'
import {
  resolveAnalyticsPeriod,
  clampTopLimit,
  resolveGeoId,
  normalizeCreativeAnalytics,
  normalizeLocalFormat,
} from '@/lib/creative-analytics'

export const maxDuration = 30

/**
 * GET /api/admin/scraper/creative-analytics
 *
 * Proxies SpyOwl GET /creative/analytics (catalog volume over a date range)
 * using settings.spyowl_cookie. Optional local is_video counts from our
 * creatives table for the same window.
 *
 * Query params:
 *   range    — 7d | 30d | 90d (default 7d) when start/end omitted
 *   start    — ISO start (requires end)
 *   end      — ISO end (requires start)
 *   topLimit — 1..50 (default 10)
 *   geo      — optional ISO country code (e.g. IE) → SpyOwl geoId
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const url = new URL(request.url)
    const range = url.searchParams.get('range') || '7d'
    const startParam = url.searchParams.get('start') || ''
    const endParam = url.searchParams.get('end') || ''
    const topLimit = clampTopLimit(url.searchParams.get('topLimit'))
    const geo = (url.searchParams.get('geo') || '').trim().toUpperCase()

    let period
    try {
      period = resolveAnalyticsPeriod({
        range: startParam && endParam ? undefined : range,
        start: startParam,
        end: endParam,
      })
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 400 })
    }

    const cookie = await getSpyOwlCookie()
    if (!cookie) {
      return Response.json(
        { ok: false, error: 'No SpyOwl cookie configured in settings.spyowl_cookie' },
        { status: 503 }
      )
    }

    let regions
    try {
      regions = await fetchEnabledGeoRegions(cookie)
    } catch (e) {
      const msg = String(e?.message || e)
      if (isAuthFailureMessage(msg)) {
        return Response.json(
          { ok: false, error: 'SpyOwl cookie expired or unauthorized', detail: msg },
          { status: 503 }
        )
      }
      return Response.json({ ok: false, error: msg }, { status: 502 })
    }

    let geoId = null
    if (geo) {
      geoId = resolveGeoId(regions, geo)
      if (!geoId) {
        return Response.json(
          { ok: false, error: `Unknown geo code: ${geo}` },
          { status: 400 }
        )
      }
    }

    let raw
    try {
      raw = await fetchCreativeAnalytics(cookie, {
        start: period.start,
        end: period.end,
        topLimit,
        geoId,
      })
    } catch (e) {
      const msg = String(e?.message || e)
      if (isAuthFailureMessage(msg)) {
        return Response.json(
          { ok: false, error: 'SpyOwl cookie expired or unauthorized', detail: msg },
          { status: 503 }
        )
      }
      return Response.json({ ok: false, error: msg }, { status: 502 })
    }

    const normalized = normalizeCreativeAnalytics(raw, regions)
    const localFormat = await fetchLocalFormatCounts(period.start, period.end, geo)

    // Promote image/video into kpis so the UI treats format as first-class
    // (SpyOwl catalog KPIs remain separate; format is our scraped DB).
    if (localFormat) {
      normalized.kpis.imageAds = localFormat.image
      normalized.kpis.videoAds = localFormat.video
      normalized.kpis.formatTotal = localFormat.total
      normalized.kpis.imagePercent = localFormat.imagePercent
      normalized.kpis.videoPercent = localFormat.videoPercent
    }

    const geos = (Array.isArray(regions) ? regions : [])
      .filter((r) => r.status === 'ENABLED' || !r.status)
      .map((r) => ({
        id: r._id,
        code: String(r.name || '').toUpperCase(),
      }))
      .filter((g) => g.code)
      .sort((a, b) => a.code.localeCompare(b.code))

    return Response.json({
      ...normalized,
      requested: {
        range: period.range,
        start: period.start,
        end: period.end,
        topLimit,
        geo: geo || null,
        geoId,
      },
      geos,
      localFormat,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
}

/**
 * Count creatives in our DB for the window by is_video (image vs video ads).
 * Uses first_seen_at (SpyOwl createdAt) when present.
 * Soft-fails to null so SpyOwl KPIs still return if Supabase is slow.
 */
async function fetchLocalFormatCounts(start, end, geoCode) {
  try {
    const base =
      `/creatives?select=id` +
      `&first_seen_at=gte.${encodeURIComponent(start)}` +
      `&first_seen_at=lte.${encodeURIComponent(end)}` +
      (geoCode ? `&geo=eq.${encodeURIComponent(geoCode)}` : '')

    const head = { method: 'HEAD', headers: { Prefer: 'count=exact' } }
    const [totalRes, videoRes, imageRes] = await Promise.all([
      supaFetch(base, head),
      supaFetch(`${base}&is_video=eq.true`, head),
      // Image ads: explicit false (do not infer as total - video; nulls stay unknown)
      supaFetch(`${base}&is_video=eq.false`, head),
    ])

    const total = totalRes?.count ?? 0
    const video = videoRes?.count ?? 0
    const image = imageRes?.count ?? 0
    const unknown = Math.max(0, total - video - image)
    return normalizeLocalFormat({ video, image, unknown, total })
  } catch (e) {
    console.error('[creative-analytics] localFormat failed:', e.message)
    return null
  }
}
