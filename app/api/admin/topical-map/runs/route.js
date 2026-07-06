import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { STAGES, DEFAULT_CONFIG } from '@/lib/topical-map/stages'
import { isKeywordDataAvailable } from '@/lib/keyword-data'

/**
 * Topical Map v2 — pipeline runs.
 *
 * POST /api/admin/topical-map/runs   { seed_keyword, config? } → create run
 * GET  /api/admin/topical-map/runs   → recent runs (no artifacts, keeps payload light)
 */

export async function POST(request) {
  try {
    verifyAdmin(request)

    if (!isKeywordDataAvailable()) {
      return Response.json(
        { error: 'DATAFORSEO_LOGIN/PASSWORD not configured. The v2 pipeline requires real keyword data — no fabrication fallback.' },
        { status: 422 }
      )
    }

    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const seedKeyword = String(body.seed_keyword || '').trim()
    if (!seedKeyword) {
      return Response.json({ error: 'seed_keyword is required' }, { status: 400 })
    }

    const config = { ...DEFAULT_CONFIG, ...(body.config && typeof body.config === 'object' ? body.config : {}) }

    const inserted = await supaFetch('/topical_map_runs?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        seed_keyword: seedKeyword,
        status: 'running',
        current_stage: STAGES[0].key,
        config,
      }),
    })
    const run = Array.isArray(inserted) ? inserted[0] : inserted
    return Response.json({ run, stages: STAGES })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(request) {
  try {
    verifyAdmin(request)
    const rows = await supaFetch(
      '/topical_map_runs?select=id,seed_keyword,status,current_stage,map_id,error,created_at,updated_at,stage_log&order=created_at.desc&limit=25'
    )
    return Response.json({ runs: Array.isArray(rows) ? rows : [], stages: STAGES })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
