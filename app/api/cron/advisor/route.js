import { runAdvisor } from '@/lib/advisor'
import { supabaseRequest } from '@/lib/supabase'

export const maxDuration = 120

/**
 * GET /api/cron/advisor
 *
 * Weekly advisor run — Monday 07:00 UTC (vercel.json), 30 min after the
 * GSC sync so the analysis sees fresh search data. Skips politely when
 * there's no data to analyze yet. Auth pattern matches the other crons.
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer' && !!process.env.CRON_SECRET && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer' && !!process.env.ADMIN_SECRET && token === process.env.ADMIN_SECRET
  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Skip when both data domains are still empty (nothing to analyze).
    const [gsc, traffic] = await Promise.all([
      supabaseRequest('/gsc_daily?select=date&limit=1', { useServiceRole: true }),
      supabaseRequest('/analytics_events?select=id&limit=1', { useServiceRole: true }),
    ])
    if ((!gsc || gsc.length === 0) && (!traffic || traffic.length === 0)) {
      return Response.json({ skipped: true, reason: 'No analytics data yet' })
    }

    const stored = await runAdvisor({ trigger: 'cron', days: 28 })
    return Response.json({
      ok: true,
      reportId: stored?.id,
      suggestions: stored?.report?.suggestions?.length ?? 0,
    })
  } catch (err) {
    console.error('[cron/advisor]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
