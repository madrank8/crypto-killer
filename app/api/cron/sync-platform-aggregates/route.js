import { computePlatformAggregates } from '@/lib/platform-aggregates'

export const maxDuration = 60

/**
 * GET /api/cron/sync-platform-aggregates
 *
 * Computes the current platform-aggregate snapshot from Supabase and POSTs
 * it to Replit's `/api/sync/platform-aggregates` receiver. Replit upserts
 * a row keyed `source = 'vercel-sync'`; the live site's article token
 * substitution layer (cryptokiller#20 — `platformStatTokens.ts`) reads
 * from there to resolve `{{platform_stat:KEY}}` references on render.
 *
 * Auth pattern matches polish-watchdog (Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}`; manual admin curls accept
 * `ADMIN_SECRET` for back-compat).
 *
 * Schedule: hourly (see vercel.json). Aggregate counts shift slowly
 * — `count(scam_brands)` moves by tens per day, `count(creatives)`
 * moves by hundreds; the writer's token resolution doesn't need
 * sub-hour freshness. Hourly stays well inside the Vercel cron quota
 * and gives Replit a refresh window that's tighter than Google
 * recrawl latency.
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer'
    && !!process.env.CRON_SECRET
    && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer'
    && !!process.env.ADMIN_SECRET
    && token === process.env.ADMIN_SECRET

  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const replitUrl = (process.env.REPLIT_SITE_URL || '').replace(/\/$/, '')
  const syncSecret = process.env.SYNC_SECRET
  if (!replitUrl || !syncSecret) {
    return Response.json(
      { error: 'REPLIT_SITE_URL and SYNC_SECRET must be configured' },
      { status: 500 },
    )
  }

  const startedAt = Date.now()
  let aggregates
  try {
    aggregates = await computePlatformAggregates()
  } catch (err) {
    console.error('[cron/sync-platform-aggregates] compute failed:', err)
    return Response.json(
      { error: 'Compute failed', detail: String(err?.message || err) },
      { status: 500 },
    )
  }

  // The /sync/platform-aggregates endpoint accepts these fields plus an
  // optional `metadata` object. We thread some lineage info through metadata
  // so Replit can show "last synced" / "computed how" diagnostics if needed.
  const payload = {
    ...aggregates,
    metadata: {
      computedAt: new Date().toISOString(),
      computedDurationMs: Date.now() - startedAt,
      source: 'vercel-cron/sync-platform-aggregates',
      vercelEnv: process.env.VERCEL_ENV || null,
    },
  }

  const url = `${replitUrl}/api/sync/platform-aggregates`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${syncSecret}`,
    },
    body: JSON.stringify(payload),
  })

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[cron/sync-platform-aggregates] Replit rejected push:', r.status, text.slice(0, 500))
    return Response.json(
      {
        error: 'Replit push failed',
        upstream_status: r.status,
        upstream_detail: text.slice(0, 500),
        payload_summary: {
          totalBrandsTracked: aggregates.totalBrandsTracked,
          totalCreativesAnalyzed: aggregates.totalCreativesAnalyzed,
        },
      },
      { status: 502 },
    )
  }

  const replitResponse = await r.json().catch(() => null)
  return Response.json({
    ok: true,
    payload,
    replit_response: replitResponse,
    duration_ms: Date.now() - startedAt,
  })
}
