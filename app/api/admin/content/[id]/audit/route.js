import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON } from '@/lib/ai-models'
import { qualityAuditorPrompt } from '@/lib/review-prompts'

/**
 * POST /api/admin/content/[id]/audit
 *
 * Re-runs ONLY the quality auditor against the already-generated article and
 * persists a fresh verdict to content.ai_audit — without re-running the
 * (token-expensive, minutes-long) full generation pipeline.
 *
 * This is the cheap recovery path for the publish gate: when the auditor timed
 * out during `fill`, the row carries ai_audit.audit_status='failed' and the
 * publish gate blocks. Rather than forcing a full "Generate Article" re-run
 * (which can time out again), the editor clicks "Re-run Audit" to try just the
 * auditor. The pipeline_stages / writer_persona provenance is preserved.
 *
 * The publish OVERRIDE remains the final backstop if the auditor keeps failing.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return Response.json({ error: 'Invalid content id' }, { status: 400 })
    }

    const rows = await supaFetch(`/content?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const content = Array.isArray(rows) ? rows[0] : null
    if (!content) return Response.json({ error: 'Content not found' }, { status: 404 })

    if (!content.full_article && !(Array.isArray(content.sections) && content.sections.length)) {
      return Response.json({
        error: 'Nothing to audit — this draft has no article body yet. Run Generate Article first.',
      }, { status: 422 })
    }

    // Reconstruct the auditor's input from the stored row (mirrors the `article`
    // object shape that fill hands the auditor).
    const reviewContent = {
      headline: content.headline || content.title || null,
      title: content.title || null,
      meta_description: content.meta_description || null,
      summary: content.summary || null,
      sections: Array.isArray(content.sections) ? content.sections : [],
      faq: Array.isArray(content.faq) ? content.faq : [],
      full_article: content.full_article || null,
      internal_links: Array.isArray(content.internal_links) ? content.internal_links : [],
      author_bio: content.ai_audit?.author_bio || null,
      item_reviewed: content.item_reviewed || null,
    }
    const sourceLedger = (Array.isArray(content.sources) ? content.sources : []).map((s) => ({
      type: s?.type || 'WebPage',
      title: s?.title || s?.url || 'source',
      url: s?.url || '',
    }))

    const auditPrompt = qualityAuditorPrompt()
    const auditMsg = auditPrompt.userTemplate(
      reviewContent,
      { name: content.title || content.headline || 'Article', scam_score: 0, total_creatives: 0, total_geos: 0, total_celebrities: 0, velocity_7d: 0, first_seen_at: null, last_seen_at: null },
      sourceLedger,
      content.schema_json || {}
    )

    // GPT-5.4 (latest) at high reasoning effort — cross-vendor judge — with
    // Claude Sonnet 4.7 as the reliability fallback (matches the fill auditor).
    const auditModels = ['gpt-5.4', 'claude-sonnet-4-7']
    let audit = null
    let auditError = null
    try {
      let res = null
      for (const modelKey of auditModels) {
        try {
          res = await callModel(modelKey, auditPrompt.system, auditMsg, {
            jsonMode: true,
            timeoutMs: 150000,
            effort: 'high',
          })
          break
        } catch (modelErr) {
          if (modelKey === auditModels[auditModels.length - 1]) throw modelErr
        }
      }
      audit = extractJSON(res.text)
    } catch (e) {
      auditError = String(e?.message || e).slice(0, 200)
    }

    // Preserve existing provenance; only swap in the fresh verdict fields.
    const prev = content.ai_audit && typeof content.ai_audit === 'object' ? content.ai_audit : {}
    let merged
    if (!audit || typeof audit !== 'object') {
      merged = { ...prev, audit_status: 'failed', audit_error: auditError || 'auditor returned no parseable verdict' }
    } else {
      merged = {
        ...prev,
        ...audit,
        audit_status: 'ok',
        audit_error: null,
        // keep provenance that lives outside the auditor's own output
        pipeline_stages: prev.pipeline_stages,
        writer_attempts: prev.writer_attempts,
        writer_persona: prev.writer_persona,
        social_proof: prev.social_proof,
        reaudited_at: new Date().toISOString(),
      }
    }

    await supaFetch(`/content?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ai_audit: merged, updated_at: new Date().toISOString() }),
    })

    const score = Number(merged.overall_score)
    return Response.json({
      ok: merged.audit_status === 'ok',
      audit_status: merged.audit_status,
      audit_error: merged.audit_error || null,
      overall_score: Number.isFinite(score) ? score : null,
      any_hard_fail: merged.hard_fail_checks?.any_hard_fail ?? null,
      hard_fail_reason: merged.hard_fail_checks?.hard_fail_reason || null,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
