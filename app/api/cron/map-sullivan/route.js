import { supabaseRequest } from '@/lib/supabase'
import { runMapSullivanTick } from '@/lib/topical-map/sullivan-agent-run'
import { callModel, extractJSON } from '@/lib/ai-models'

export const maxDuration = 300

/**
 * GET /api/cron/map-sullivan
 * Classifies + gathers Sullivan evidence for one writable topic.
 * Never publishes, never writes articles. Kill switch: AGENT_SULLIVAN=0 or AGENT_RUNNER=0.
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
    const result = await runMapSullivanTick({
      supabaseRequest,
      env: process.env,
      callModel,
      extractJSON,
      firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
      fetchImpl: fetch,
    })
    return Response.json(result)
  } catch (err) {
    console.error('[cron/map-sullivan]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
