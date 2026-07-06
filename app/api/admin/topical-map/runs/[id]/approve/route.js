import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * POST /api/admin/topical-map/runs/[id]/approve
 *
 * Clears a checkpoint (pool_review after serp_clustering, qa_review after
 * qa) so the dashboard can continue advancing.
 *
 * Body (optional edits at pool_review):
 *   { removed_cluster_keys?: string[], removed_keywords?: string[] }
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params

    const rows = await supaFetch(`/topical_map_runs?id=eq.${id}&select=*`)
    const run = Array.isArray(rows) ? rows[0] : null
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })
    if (run.status !== 'awaiting_approval') {
      return Response.json({ error: `Run is ${run.status}, not awaiting approval` }, { status: 409 })
    }

    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const artifacts = run.artifacts || {}
    const removedClusters = new Set(body.removed_cluster_keys || [])
    const removedKeywords = new Set((body.removed_keywords || []).map((k) => String(k).toLowerCase()))

    if (removedClusters.size > 0 && Array.isArray(artifacts.clusters)) {
      artifacts.clusters = artifacts.clusters.filter((c) => !removedClusters.has(c.cluster_key))
    }
    if (removedKeywords.size > 0) {
      if (Array.isArray(artifacts.pool)) {
        artifacts.pool = artifacts.pool.filter((e) => !removedKeywords.has(e.keyword))
      }
      if (Array.isArray(artifacts.clusters)) {
        for (const c of artifacts.clusters) {
          c.keywords = c.keywords.filter((k) => !removedKeywords.has(k.keyword))
        }
        artifacts.clusters = artifacts.clusters.filter((c) => c.keywords.length > 0)
      }
    }

    await supaFetch(`/topical_map_runs?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'running',
        artifacts,
        updated_at: new Date().toISOString(),
      }),
    })

    return Response.json({ ok: true, status: 'running', current_stage: run.current_stage })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
