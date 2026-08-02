import { callModel, extractJSON } from '@/lib/ai-models'
import { qualityAuditorPrompt } from '@/lib/review-prompts'
import { stampAudit } from '@/lib/audit-freshness'

/**
 * The one place the quality auditor is run against an existing `content` row.
 *
 * Two routes need this: "Re-run Audit" and remediation (which must re-audit after
 * applying its fixes, or it would publish against the verdict it just invalidated).
 * The reason it is shared rather than copied is a bug this repo already shipped:
 * the re-audit route built its own `reviewContent` and omitted `not_for_you`, so
 * the auditor saw the field as absent and failed `not_for_you_block_present` on
 * every row that in fact had the block. A missing input does not make a check
 * lenient, it makes it fail. Two hand-maintained copies of this payload would
 * reintroduce that divergence the first time a check gained an input.
 *
 * Note the asymmetry with the generation pipeline: `content/fill` audits an
 * in-memory article it is about to write, so it builds its own payload from local
 * variables. This module audits a row that already exists.
 */

/**
 * Reconstruct the auditor's view of a stored row.
 *
 * Every field any `hard_fail_checks` key inspects must appear here.
 *
 * @param {object} content - a `content` row
 */
function buildAuditInput(content) {
  const reviewContent = {
    headline: content.headline || content.title || null,
    title: content.title || null,
    meta_description: content.meta_description || null,
    summary: content.summary || null,
    sections: Array.isArray(content.sections) ? content.sections : [],
    faq: Array.isArray(content.faq) ? content.faq : [],
    full_article: content.full_article || null,
    internal_links: Array.isArray(content.internal_links) ? content.internal_links : [],
    // The bio lives inside ai_audit rather than on the row, which is why
    // audit-freshness cannot hash it.
    author_bio: content.ai_audit?.author_bio || null,
    item_reviewed: content.item_reviewed || null,
    not_for_you: content.not_for_you || null,
    information_gain_summary: content.information_gain_summary || null,
    verify_tags_count: typeof content.verify_tags_count === 'number' ? content.verify_tags_count : null,
    // Schema enrichment runs AFTER the auditor during `fill`, so a first-pass
    // audit never sees claims and `claims_appearance_populated` passes vacuously.
    // On a re-audit the claims are already on the row, so passing them makes that
    // check meaningful.
    claims: Array.isArray(content.claims) ? content.claims : [],
  }

  const sourceLedger = (Array.isArray(content.sources) ? content.sources : []).map((s) => ({
    type: s?.type || 'WebPage',
    title: s?.title || s?.url || 'source',
    url: s?.url || '',
  }))

  return { reviewContent, sourceLedger }
}

/**
 * GPT-5.4 Mini at high reasoning effort — a cross-vendor judge, so the grader is
 * not the same model family that wrote the text — with Claude Sonnet as the
 * reliability fallback. These are the IDs the accounts can actually call;
 * `gpt-5.4` / `claude-sonnet-4-7` 403/404 and broke the live auditor.
 */
const AUDIT_MODELS = ['gpt-5.4-mini', 'claude-sonnet']

/**
 * Run the auditor against a row. Never throws for audit failure: a model timeout
 * is an infrastructure event, and callers need to distinguish it from a verdict.
 *
 * @param {object} content - a `content` row
 * @returns {Promise<{ audit: object|null, auditError: string|null, auditModelUsed: string|null }>}
 */
async function runQualityAudit(content) {
  const { reviewContent, sourceLedger } = buildAuditInput(content)

  const auditPrompt = qualityAuditorPrompt()
  const auditMsg = auditPrompt.userTemplate(
    reviewContent,
    {
      name: content.title || content.headline || 'Article',
      scam_score: 0,
      total_creatives: 0,
      total_geos: 0,
      total_celebrities: 0,
      velocity_7d: 0,
      first_seen_at: null,
      last_seen_at: null,
    },
    sourceLedger,
    content.schema_json || {},
  )

  let auditModelUsed = null
  try {
    let res = null
    for (const modelKey of AUDIT_MODELS) {
      try {
        res = await callModel(modelKey, auditPrompt.system, auditMsg, {
          jsonMode: true,
          timeoutMs: 150000,
          effort: 'high',
        })
        auditModelUsed = res.model || modelKey
        break
      } catch (modelErr) {
        // Loud, not silent: a primary failure means the cross-vendor judge was
        // skipped and a same-family Claude fallback graded instead.
        console.warn(`[audit] model ${modelKey} failed: ${modelErr.message} — falling back`)
        if (modelKey === AUDIT_MODELS[AUDIT_MODELS.length - 1]) throw modelErr
      }
    }
    return { audit: extractJSON(res.text), auditError: null, auditModelUsed }
  } catch (e) {
    return { audit: null, auditError: String(e?.message || e).slice(0, 200), auditModelUsed }
  }
}

/**
 * Fold a fresh verdict into the existing `ai_audit`, preserving the provenance
 * that lives outside the auditor's own output (pipeline stages, writer persona,
 * author bio, social proof) — those describe how the article was made and are not
 * the auditor's to overwrite.
 *
 * @param {object} content - the row the auditor judged, AFTER any fixes were applied
 * @param {object|null} audit - parsed auditor output, or null if it failed
 * @param {{ auditError?: string|null, auditModelUsed?: string|null }} meta
 * @returns {object} the object to persist as `ai_audit`
 */
function mergeAuditVerdict(content, audit, { auditError = null, auditModelUsed = null } = {}) {
  const prev = content.ai_audit && typeof content.ai_audit === 'object' ? content.ai_audit : {}

  if (!audit || typeof audit !== 'object') {
    return {
      ...prev,
      audit_status: 'failed',
      audit_error: auditError || 'auditor returned no parseable verdict',
    }
  }

  const merged = {
    ...prev,
    ...audit,
    audit_status: 'ok',
    audit_error: null,
    // Which model actually produced this verdict, so a silent fallback to the
    // same-family judge is visible.
    audit_model: auditModelUsed,
    pipeline_stages: prev.pipeline_stages,
    writer_attempts: prev.writer_attempts,
    writer_persona: prev.writer_persona,
    social_proof: prev.social_proof,
    reaudited_at: new Date().toISOString(),
  }

  // Bind the verdict to the exact content it judged, so a later edit marks it
  // stale instead of blocking publish forever on findings about deleted text. A
  // failed audit is left unstamped: a hash would assert a verdict this run never
  // produced.
  return stampAudit(merged, content)
}

export { buildAuditInput, runQualityAudit, mergeAuditVerdict, AUDIT_MODELS }
