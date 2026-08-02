import { runNextWorkItem } from '@/lib/advisor-actions'

export const maxDuration = 60

/**
 * GET /api/cron/advisor-runner
 * Claims one queued Work Plan item and executes it (draft/redirect only
 * unless AGENT_AUTOPUBLISH=1 + allowlist).
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
    const origin = new URL(request.url).origin
    // Runner calls internal admin APIs with ADMIN_SECRET (machine auth).
    const machineAuth = `Bearer ${process.env.ADMIN_SECRET || ''}`
    const result = await runNextWorkItem({ origin, authHeader: machineAuth })
    return Response.json(result)
  } catch (err) {
    console.error('[cron/advisor-runner]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
