import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export const maxDuration = 30

/**
 * GET /api/admin/analytics/traffic?days=30
 *
 * Traffic overview from analytics_events via the RPCs in migration 009.
 * RPC calls are POSTs → service_role in lib/supabase.js, which bypasses
 * the policy-less RLS on the raw table.
 */

function rpc(fn, args) {
  return supabaseRequest(`/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  })
}

export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365)

  try {
    const [summary, timeseries, pages, referrers, countries, devices, locales, clicks] =
      await Promise.all([
        rpc('analytics_summary', { p_days: days }),
        rpc('analytics_timeseries', { p_days: days }),
        rpc('analytics_top', { p_days: days, p_dim: 'path', p_limit: 12 }),
        rpc('analytics_top', { p_days: days, p_dim: 'referrer_host', p_limit: 10 }),
        rpc('analytics_top', { p_days: days, p_dim: 'country', p_limit: 10 }),
        rpc('analytics_top', { p_days: days, p_dim: 'device', p_limit: 3 }),
        rpc('analytics_top', { p_days: days, p_dim: 'locale', p_limit: 8 }),
        rpc('analytics_top_clicks', { p_days: days, p_limit: 10 }),
      ])

    return Response.json({
      days,
      summary,
      timeseries,
      top: { pages, referrers, countries, devices, locales, clicks },
    })
  } catch (err) {
    console.error('[admin/analytics/traffic]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
