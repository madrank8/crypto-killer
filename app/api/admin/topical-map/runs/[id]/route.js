import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { STAGES } from '@/lib/topical-map/stages'

/**
 * GET /api/admin/topical-map/runs/[id] — run status + checkpoint payloads.
 * Full artifacts are large; return the pieces the dashboard needs.
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    const rows = await supaFetch(`/topical_map_runs?id=eq.${id}&select=*`)
    const run = Array.isArray(rows) ? rows[0] : null
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })

    const a = run.artifacts || {}
    const view = {
      id: run.id,
      seed_keyword: run.seed_keyword,
      status: run.status,
      current_stage: run.current_stage,
      map_id: run.map_id,
      error: run.error,
      config: run.config,
      stage_log: run.stage_log,
      created_at: run.created_at,
      updated_at: run.updated_at,
      checkpoint_data: null,
    }

    if (run.status === 'awaiting_approval') {
      if (run.current_stage === 'competitor_gap') {
        // Checkpoint A (after serp_clustering): pool + cluster review.
        // Includes member keywords + the unclustered list so the dashboard
        // can offer per-keyword editing before approval.
        const poolByKeyword = new Map((a.pool || []).map((e) => [e.keyword, e]))
        view.checkpoint_data = {
          checkpoint: 'pool_review',
          pool_size: (a.pool || []).length,
          clusters: (a.clusters || []).map((c) => ({
            cluster_key: c.cluster_key,
            head_keyword: c.head_keyword,
            total_volume: c.total_volume,
            keyword_count: c.keywords.length,
            dominant_intent: c.dominant_intent,
            aio_risk: c.aio_risk,
            authority: c.authority || null,
            keywords: c.keywords.map((k) => ({
              keyword: k.keyword,
              search_volume: k.search_volume ?? null,
              keyword_difficulty: k.keyword_difficulty ?? null,
            })),
          })),
          unclustered: (a.unclustered || []).slice(0, 100).map((kw) => {
            const e = poolByKeyword.get(kw)
            return { keyword: kw, search_volume: e?.search_volume ?? null }
          }),
          unclustered_count: (a.unclustered || []).length,
        }
      } else if (run.current_stage === 'save') {
        // Checkpoint B (after qa): QA report review
        view.checkpoint_data = { checkpoint: 'qa_review', qa_report: a.qa_report || null }
      }
    }

    return Response.json({ run: view, stages: STAGES })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/topical-map/runs/[id] — cancel a run.
 */
export async function DELETE(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    await supaFetch(`/topical_map_runs?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() }),
    })
    return Response.json({ ok: true })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
