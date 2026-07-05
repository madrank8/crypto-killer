import { runAdvisor } from '@/lib/advisor'
import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export const maxDuration = 120

/**
 * POST /api/admin/advisor/run
 *
 * On-demand advisor analysis. Rate-limited: rejects if a complete report
 * exists from the last 30 minutes unless body { force: true } — a Sonnet
 * run costs real tokens and the data doesn't move that fast.
 */
export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  let body = {}
  try {
    body = await request.json()
  } catch { /* empty body fine */ }

  try {
    if (!body.force) {
      const recent = await supabaseRequest(
        `/advisor_reports?status=eq.complete&created_at=gte.${new Date(Date.now() - 30 * 60000).toISOString()}&select=id,created_at&limit=1`,
        { useServiceRole: true }
      )
      if (recent && recent.length > 0) {
        return Response.json(
          { error: 'A report was generated less than 30 minutes ago. Pass force:true to re-run.', recent: recent[0] },
          { status: 429 }
        )
      }
    }

    const days = Math.min(Math.max(parseInt(body.days, 10) || 28, 7), 90)
    const stored = await runAdvisor({ trigger: 'manual', days })
    return Response.json({ ok: true, report: stored })
  } catch (err) {
    console.error('[advisor/run]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
