import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { runQualityAudit, mergeAuditVerdict } from '@/lib/run-quality-audit'
import { evaluateHardFails } from '@/lib/audit-gate'

// The auditor calls a model with a 150s timeout plus a fallback model, so the
// worst case is ~300s. Without this the route inherits the platform default and
// gets killed mid-audit, writing audit_status='failed' for a purely
// infrastructural reason. Matches content/fill.
export const maxDuration = 300

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

    // The auditor payload, model chain and verdict merge live in
    // lib/run-quality-audit so this route and remediation cannot drift apart.
    // Hashing `content` is correct here because this route writes nothing but
    // `ai_audit` — the auditor's inputs on the row are unchanged.
    const { audit, auditError, auditModelUsed } = await runQualityAudit(content)
    const merged = mergeAuditVerdict(content, audit, { auditError, auditModelUsed })

    await supaFetch(`/content?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ai_audit: merged, updated_at: new Date().toISOString() }),
    })

    const score = Number(merged.overall_score)
    // Report the GATE's reading of the verdict, not the model's raw
    // `any_hard_fail`. The two disagree whenever the model vetoed on a check
    // that does not apply to this row (e.g. item_reviewed_typed on a blog post),
    // and echoing the raw flag would tell the editor a re-audit still fails when
    // publish would in fact accept it.
    const gate = evaluateHardFails(merged, content)
    return Response.json({
      ok: merged.audit_status === 'ok',
      audit_status: merged.audit_status,
      audit_error: merged.audit_error || null,
      // Echo the judge so a smoke test can confirm the cross-vendor model ran
      // (vs. having silently fallen back to Claude).
      audit_model: merged.audit_model || null,
      overall_score: Number.isFinite(score) ? score : null,
      any_hard_fail: gate.any_hard_fail,
      hard_fail_reason: gate.failed.map((f) => `${f.key}: ${f.reason}`).join('; ') || null,
      // What the model said, for provenance when the two disagree.
      model_reported_hard_fail: merged.hard_fail_checks?.any_hard_fail ?? null,
      skipped_checks: gate.skipped,
      warnings: gate.warnings,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
