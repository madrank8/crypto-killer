import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { executeCurrentStage, STAGES } from '@/lib/topical-map/stages'

export const maxDuration = 300

/**
 * POST /api/admin/topical-map/runs/[id]/advance
 *
 * Executes the run's CURRENT stage, persists artifacts, and moves the
 * pointer to the next stage. The dashboard loops this endpoint until the
 * run is completed / awaiting_approval / failed. A failed run stays on
 * its current stage — calling advance again retries it (resumable).
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params

    const rows = await supaFetch(`/topical_map_runs?id=eq.${id}&select=*`)
    const run = Array.isArray(rows) ? rows[0] : null
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })

    if (run.status === 'completed') {
      return Response.json({ error: 'Run already completed', run: publicView(run) }, { status: 409 })
    }
    if (run.status === 'cancelled') {
      return Response.json({ error: 'Run was cancelled', run: publicView(run) }, { status: 409 })
    }
    if (run.status === 'awaiting_approval') {
      return Response.json(
        { error: 'Run is awaiting checkpoint approval — call /approve first', run: publicView(run) },
        { status: 409 }
      )
    }

    // Mark running (clears failed state for retry)
    if (run.status !== 'running') {
      await supaFetch(`/topical_map_runs?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'running', error: null, updated_at: new Date().toISOString() }),
      })
      run.status = 'running'
      run.error = null
    }

    try {
      const result = await executeCurrentStage(run, { supaFetch })

      const stageLog = Array.isArray(run.stage_log) ? run.stage_log : []
      stageLog.push(result.logEntry)

      await supaFetch(`/topical_map_runs?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          artifacts: result.artifacts,
          current_stage: result.current_stage,
          status: result.status,
          map_id: result.map_id,
          stage_log: stageLog,
          error: null,
          updated_at: new Date().toISOString(),
        }),
      })

      return Response.json({
        ok: true,
        executed_stage: result.logEntry.stage,
        summary: result.logEntry.summary,
        ms: result.logEntry.ms,
        status: result.status,
        current_stage: result.current_stage,
        checkpoint: result.checkpoint,
        done: result.done,
        map_id: result.map_id,
        stages: STAGES,
      })
    } catch (stageError) {
      const stageLog = Array.isArray(run.stage_log) ? run.stage_log : []
      stageLog.push({
        stage: run.current_stage,
        ok: false,
        summary: String(stageError?.message || stageError).slice(0, 300),
        at: new Date().toISOString(),
      })
      await supaFetch(`/topical_map_runs?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed',
          error: String(stageError?.message || stageError).slice(0, 500),
          stage_log: stageLog,
          updated_at: new Date().toISOString(),
        }),
      })
      return Response.json(
        { ok: false, failed_stage: run.current_stage, error: String(stageError?.message || stageError), resumable: true },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

function publicView(run) {
  return {
    id: run.id,
    status: run.status,
    current_stage: run.current_stage,
    map_id: run.map_id,
    error: run.error,
  }
}
