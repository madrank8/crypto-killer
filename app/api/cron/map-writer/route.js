import { supabaseRequest } from '@/lib/supabase'
import { runMapWriterTick } from '@/lib/topical-map/map-writer-run'

export const maxDuration = 700

/**
 * GET /api/cron/map-writer
 * Advances one due topical-map topic one outline→fill stage into a draft.
 * Never publishes. Kill switch: AGENT_AUTODRAFT=0 or AGENT_RUNNER=0.
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
    const machineAuth = `Bearer ${process.env.ADMIN_SECRET || ''}`
    const result = await runMapWriterTick({
      supabaseRequest,
      origin,
      authHeader: machineAuth,
      env: process.env,
    })
    return Response.json(result)
  } catch (err) {
    console.error('[cron/map-writer]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
