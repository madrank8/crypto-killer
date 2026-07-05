import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { gscConfigured } from '@/lib/gsc'

export const maxDuration = 30

/**
 * GET /api/admin/analytics/search?days=28
 *
 * Search performance from gsc_daily (populated by /api/cron/gsc-sync).
 * Returns { configured: false } when GSC env vars are missing so the UI
 * can render setup instructions instead of an error.
 */

export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '28', 10) || 28, 1), 480)
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)

  try {
    // Daily totals come from the page dimension (summing queries would
    // undercount: GSC omits anonymized queries from the query dimension).
    const pageRows = await supabaseRequest(
      `/gsc_daily?dimension=eq.page&date=gte.${since}&select=date,key,clicks,impressions,position&order=date.asc&limit=20000`,
      { useServiceRole: true }
    )
    const queryRows = await supabaseRequest(
      `/gsc_daily?dimension=eq.query&date=gte.${since}&select=key,clicks,impressions,position&limit=20000`,
      { useServiceRole: true }
    )

    // Timeseries: aggregate page rows by date
    const byDate = new Map()
    for (const r of pageRows || []) {
      const d = byDate.get(r.date) || { date: r.date, clicks: 0, impressions: 0 }
      d.clicks += r.clicks
      d.impressions += r.impressions
      byDate.set(r.date, d)
    }
    const timeseries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))

    // Top pages: aggregate across dates
    const aggBy = (rows) => {
      const m = new Map()
      for (const r of rows || []) {
        const cur = m.get(r.key) || { key: r.key, clicks: 0, impressions: 0, posSum: 0, posW: 0 }
        cur.clicks += r.clicks
        cur.impressions += r.impressions
        // impression-weighted average position
        cur.posSum += (r.position || 0) * r.impressions
        cur.posW += r.impressions
        m.set(r.key, cur)
      }
      return [...m.values()]
        .map((r) => ({
          key: r.key,
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.impressions ? r.clicks / r.impressions : 0,
          position: r.posW ? r.posSum / r.posW : null,
        }))
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    }

    const totals = timeseries.reduce(
      (acc, d) => ({ clicks: acc.clicks + d.clicks, impressions: acc.impressions + d.impressions }),
      { clicks: 0, impressions: 0 }
    )

    return Response.json({
      configured: gscConfigured(),
      hasData: (pageRows || []).length > 0,
      days,
      totals: {
        ...totals,
        ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
      },
      timeseries,
      topPages: aggBy(pageRows).slice(0, 15),
      topQueries: aggBy(queryRows).slice(0, 15),
    })
  } catch (err) {
    console.error('[admin/analytics/search]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
