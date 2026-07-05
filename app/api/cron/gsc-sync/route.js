import { gscQuery, gscConfigured } from '@/lib/gsc'
import { supabaseRequest } from '@/lib/supabase'

export const maxDuration = 120

/**
 * GET /api/cron/gsc-sync
 *
 * Pulls daily Search Console performance (page + query dimensions) into
 * Supabase `gsc_daily`. GSC data lags ~2 days and back-fills, so each run
 * re-syncs the trailing 5 days and upserts on (date, dimension, key) —
 * idempotent, safe to re-run.
 *
 * Auth matches the other crons: Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}`; manual curls accept ADMIN_SECRET.
 *
 * Schedule: daily 06:30 UTC (vercel.json) — after Google finalizes the
 * previous day's data.
 */

const LOOKBACK_DAYS = 5

function iso(d) {
  return d.toISOString().slice(0, 10)
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer' && !!process.env.CRON_SECRET && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer' && !!process.env.ADMIN_SECRET && token === process.env.ADMIN_SECRET
  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!gscConfigured()) {
    return Response.json({
      skipped: true,
      reason: 'GSC env vars not set (GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, GSC_SITE_URL)',
    })
  }

  try {
    const end = new Date(Date.now() - 24 * 3600 * 1000) // yesterday
    const start = new Date(end.getTime() - (LOOKBACK_DAYS - 1) * 24 * 3600 * 1000)
    const startDate = iso(start)
    const endDate = iso(end)

    const [pageRows, queryRows] = await Promise.all([
      gscQuery({ startDate, endDate, dimensions: ['date', 'page'] }),
      gscQuery({ startDate, endDate, dimensions: ['date', 'query'] }),
    ])

    const toRecord = (dimension) => (r) => ({
      date: r.keys[0],
      dimension,
      // Store pages as paths — keeps joins to analytics_events trivial
      key: dimension === 'page' ? (r.keys[1] || '').replace(/^https?:\/\/[^/]+/, '') || '/' : r.keys[1],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      synced_at: new Date().toISOString(),
    })

    const records = [
      ...pageRows.map(toRecord('page')),
      ...queryRows.map(toRecord('query')),
    ]

    // Upsert in chunks to stay under PostgREST payload limits
    const CHUNK = 500
    for (let i = 0; i < records.length; i += CHUNK) {
      await supabaseRequest('/gsc_daily?on_conflict=date,dimension,key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(records.slice(i, i + CHUNK)),
      })
    }

    return Response.json({
      ok: true,
      range: { startDate, endDate },
      pages: pageRows.length,
      queries: queryRows.length,
      upserted: records.length,
    })
  } catch (err) {
    console.error('[gsc-sync]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
