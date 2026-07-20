import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON } from '@/lib/ai-models'
import { buildEnrichmentPrompt, mergeEnrichment } from '@/lib/content-brief/enrich'

/**
 * POST /api/admin/topical-map/topics/[id]/content-brief/enrich
 *
 * Fills the creative sections of an already-assembled brief with an LLM pass.
 *
 * Guardrails are STRUCTURAL, not prompt-only: whatever the model returns goes
 * through mergeEnrichment, which discards anything targeting a measured,
 * deterministic, or human-supplied field and strips unverifiable identifiers
 * (PMIDs/DOIs/URLs) from claim seeds. The blocked attempts are returned in
 * `rejected` so the operator can see what the model tried to write.
 *
 * Requires a PASSING Sullivan Gate — enriching a commodity brief is exactly what
 * SC-098 exists to prevent.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const rows = await supaFetch(`/content_briefs?topic_id=eq.${id}&select=*&limit=1`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return Response.json({ error: 'No content brief yet — save the Sullivan Gate first.' }, { status: 404 })
    if (!row.sullivan_ok) {
      return Response.json({ error: 'Sullivan Gate has not passed. Supply the forcing inputs before enriching.' }, { status: 409 })
    }
    if (!row.brief) return Response.json({ error: 'No assembled brief to enrich.' }, { status: 409 })

    const topicRows = await supaFetch(`/topics?id=eq.${id}&select=id,title,target_keyword,content_type&limit=1`)
    const topic = (Array.isArray(topicRows) ? topicRows[0] : null) || {}

    const { system, user } = buildEnrichmentPrompt(row.brief, topic)

    let parsed = null
    let modelUsed = null
    let lastErr = null
    for (const model of ['claude-sonnet', 'claude-haiku']) {
      try {
        const result = await callModel(model, system, user, { timeoutMs: 120000 })
        parsed = extractJSON(result.text)
        if (parsed && typeof parsed === 'object') { modelUsed = model; break }
        lastErr = new Error('Model returned unparseable JSON')
      } catch (err) {
        lastErr = err
      }
    }
    if (!parsed) {
      // Leave the existing brief untouched — a failed enrichment must never
      // degrade what was already assembled.
      return Response.json({ error: `Enrichment failed: ${lastErr?.message || 'unknown error'}` }, { status: 502 })
    }

    const { brief, rejected, enriched } = mergeEnrichment(row.brief, parsed)

    await supaFetch(`/content_briefs?topic_id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ brief, updated_at: new Date().toISOString() }),
    })

    const after = await supaFetch(`/content_briefs?topic_id=eq.${id}&select=*&limit=1`)
    return Response.json({
      brief_row: Array.isArray(after) ? after[0] : null,
      enriched,
      rejected,
      model: modelUsed,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
