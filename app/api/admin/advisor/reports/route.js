import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/advisor/reports?limit=10
 *
 * Report history (newest first) + all suggestion states, so the UI can
 * render done/dismissed across reports in one round trip.
 */
export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 50)

  try {
    const [reports, states] = await Promise.all([
      supabaseRequest(
        `/advisor_reports?select=id,created_at,trigger_type,period_days,model,status,error,report,tokens_in,tokens_out&order=created_at.desc&limit=${limit}`,
        { useServiceRole: true }
      ),
      supabaseRequest('/advisor_suggestion_states?select=fingerprint,state&limit=2000', {
        useServiceRole: true,
      }),
    ])
    return Response.json({
      reports: reports || [],
      states: Object.fromEntries((states || []).map((s) => [s.fingerprint, s.state])),
    })
  } catch (err) {
    console.error('[advisor/reports]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
