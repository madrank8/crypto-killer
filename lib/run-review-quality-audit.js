/**
 * Shared review quality-audit runner (LLM auditor + deterministic integrity).
 *
 * Used by polish and by Fix & Publish so both paths persist the same
 * audit_hard_fail / trust_indicators shape.
 */

'use strict'

const { callModel, extractJSON } = require('./ai-models')
const { buildReviewSchema } = require('./review-schema')
const { qualityAuditorPrompt } = require('./review-prompts')
const { checkReviewIntegrity } = require('./review-integrity')
const { dedupeCelebrityList, classifyThreat } = require('./threat-score')

const PIPELINE_VERSION = 'multi-agent-v1.1-split'

/**
 * Build the reviewContent + schema payload the quality auditor expects.
 * @param {object} review
 * @param {object} brandData
 */
function buildAuditInputs(review, brandData) {
  const currentDate = review.review_date || new Date().toISOString().split('T')[0]
  const longevityDays =
    review.trust_indicators?.investigation_period_days ||
    (brandData.last_seen_at && brandData.first_seen_at
      ? Math.max(
          1,
          Math.round(
            (new Date(brandData.last_seen_at) - new Date(brandData.first_seen_at)) / 86400000,
          ),
        )
      : 0)

  const reviewContent = {
    title: review.title,
    headline: review.headline,
    meta_description: review.meta_description,
    summary: review.summary,
    how_it_works: review.how_it_works,
    red_flags: review.red_flags || [],
    verdict: review.verdict,
    faq: review.faq || [],
    internal_links: review.internal_links || [],
    key_takeaways: review.key_takeaways || [],
    not_for_you: review.not_for_you,
    protection_steps: review.protection_steps,
    experience_signals: review.experience_signals || [],
    expertise_depth: review.expertise_depth,
    methodology: review.methodology,
    sources: review.sources || [],
    disclaimer: review.disclaimer,
    item_reviewed: review.item_reviewed || null,
    schema_enrichment: {
      dataset: review.dataset || null,
      claims: review.claims || [],
      item_list: review.item_list || null,
      citations: review.citations || [],
    },
  }

  const auditBrandData = {
    ...brandData,
    celebrity_names: dedupeCelebrityList(brandData.celebrity_list || []),
  }

  const tempSchema = buildReviewSchema({
    reviewContent,
    brandData,
    slug: review.slug,
    currentDate,
    wordCount: review.word_count || 0,
    longevityDays,
    threat: classifyThreat(brandData.scam_score ?? 0),
    dataset: review.dataset || null,
    claims: Array.isArray(review.claims) ? review.claims : [],
    itemList: Array.isArray(review.item_list?.items)
      ? review.item_list.items
      : Array.isArray(review.item_list)
        ? review.item_list
        : [],
    typedCitations: Array.isArray(review.citations) ? review.citations : [],
  })

  return { reviewContent, auditBrandData, tempSchema }
}

/**
 * Run the quality auditor + integrity check. Does not write to the DB.
 *
 * @param {object} review - review row (use post-remediation fields)
 * @param {object} brandData - scam_brands row
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 */
async function runReviewQualityAudit(review, brandData, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}

  let auditReport = null
  let auditActualModel = null

  try {
    const { reviewContent, auditBrandData, tempSchema } = buildAuditInputs(review, brandData)
    const auditPromptData = qualityAuditorPrompt()
    const auditUserMsg = auditPromptData.userTemplate(
      reviewContent,
      auditBrandData,
      review.sources || [],
      tempSchema,
    )

    const auditModels = ['gpt-5.4-mini', 'claude-sonnet']
    let auditResult = null
    for (const modelKey of auditModels) {
      try {
        onProgress(`Auditing with ${modelKey}…`)
        auditResult = await callModel(modelKey, auditPromptData.system, auditUserMsg, {
          jsonMode: true,
          effort: 'high',
        })
        break
      } catch (modelErr) {
        console.error(`[run-review-quality-audit] ${modelKey} failed:`, modelErr.message)
        if (modelKey === auditModels[auditModels.length - 1]) throw modelErr
        onProgress(`${modelKey} unavailable, retrying…`)
      }
    }

    auditReport = extractJSON(auditResult.text)
    auditActualModel = auditResult.usedFallback
      ? `${auditResult.resolvedModel} (fallback from ${auditResult.fallbackFrom})`
      : auditResult.label || auditResult.resolvedModel
  } catch (auditError) {
    console.error('[run-review-quality-audit] Quality audit failed:', auditError.message)
    auditActualModel = `failed (${String(auditError.message || '').slice(0, 100)})`
  }

  const llmHardFail = auditReport?.hard_fail_checks?.any_hard_fail === true
  const llmHardFailReason = llmHardFail
    ? auditReport?.hard_fail_checks?.hard_fail_reason ||
      'Quality auditor flagged a hard fail (see critical_fixes).'
    : null

  const integrity = checkReviewIntegrity({
    review: {
      ...review,
      full_article: review.full_article,
      scam_score: review.scam_score,
      title: review.title,
    },
    brand: brandData,
  })

  const hardFail = llmHardFail || !integrity.ok
  const hardFailReason =
    [llmHardFailReason, integrity.hardFailReason].filter(Boolean).join(' || ') || null

  const trust_indicators = {
    ...(review.trust_indicators || {}),
    pipeline_version: PIPELINE_VERSION,
    audit_model: auditActualModel || null,
    audit_score: auditReport?.overall_score ?? null,
    audit_grade: auditReport?.grade ?? null,
    audit_critical_fixes: auditReport?.critical_fixes || [],
  }

  return {
    auditReport,
    auditActualModel,
    audit_hard_fail: hardFail,
    audit_hard_fail_reason: hardFailReason,
    trust_indicators,
    integrity,
    pipeline_version: PIPELINE_VERSION,
  }
}

module.exports = {
  runReviewQualityAudit,
  buildAuditInputs,
  PIPELINE_VERSION,
}
