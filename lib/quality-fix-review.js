'use strict'

/**
 * Review-row adapter for the shared Quality Fix Agent.
 * Mirrors lib/quality-fix-content.js with review-specific hard-fail sources,
 * deterministic remediations (disclosure / visual scrub / remediateReview),
 * polish-style reaudit → audit_hard_fail flags, and publish without override.
 */

const { callModel, extractJSON } = require('./ai-models')
const { remediateReview } = require('./review-remediate')
const { evaluateHardFails } = require('./audit-gate')
const { checkReviewIntegrity } = require('./review-integrity')
const { supaFetch } = require('./supabase')
const { applySurgicalPatches } = require('./quality-fix-surgical')
const { researchSourcesForClaims } = require('./quality-fix-research')
const { runQualityFixAgent } = require('./quality-fix-agent')
const { callQualityFixModel } = require('./quality-fix-model')
const { qualityAuditorPrompt } = require('./review-prompts')
const { buildReviewSchema } = require('./review-schema')
const { dedupeCelebrityList, classifyThreat, brandEvidence } = require('./threat-score')
const {
  DISCLOSURE_HEADING,
  DISCLOSURE_TEXT,
  hasRiskDisclosure,
  appendDisclosureToHtml,
} = require('./ymyl-disclosure')

const AUDIT_MODELS = ['gpt-5.4-mini', 'claude-sonnet']

const KNOWN_HARD_FAIL_KEYS = [
  'fabricated_source_or_stat',
  'fake_or_unmarked_freshness',
  'fabricated_reviews_or_testimonials',
  'missing_risk_or_ftc_disclosure',
  'commodity_no_information_gain',
  'not_for_you_block_present',
  'item_reviewed_typed',
  'unverified_claims_in_article',
  'source_ledger_claims_without_links',
  'any_hard_fail',
  'score_drift',
  'title_score_drift',
]

const VISUAL_PLACEHOLDER_RE =
  /\[\s*(CHART|DIAGRAM|IMAGE|INFOGRAPHIC|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED[^\]]*\]/gi

const SCRUB_STRING_FIELDS = [
  'title',
  'headline',
  'meta_description',
  'summary',
  'verdict',
  'how_it_works',
  'not_for_you',
  'protection_steps',
  'methodology',
  'expertise_depth',
  'full_article',
  'disclaimer',
  'information_gain_summary',
]

function resolveOrigin(origin) {
  if (typeof origin === 'string' && origin.trim()) return origin.replace(/\/$/, '')
  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (typeof site === 'string' && site.trim()) return site.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '')
  return 'http://localhost:3000'
}

function scrubVisualPlaceholders(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(VISUAL_PLACEHOLDER_RE, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function scrubArrayItems(items, keys) {
  if (!Array.isArray(items)) return items
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item
    const next = { ...item }
    for (const key of keys) {
      if (typeof next[key] === 'string') next[key] = scrubVisualPlaceholders(next[key])
    }
    return next
  })
}

/**
 * Synthesize hard-fail entries from persisted audit_hard_fail / reason.
 * Used when LLM hard_fail_checks are absent or look clean but the row is still
 * vetoed (integrity / auditError paths set the flag without flipping checks).
 * @param {object} row
 * @returns {Array<{ key: string, reason: string }>}
 */
function synthesizeFromAuditHardFail(row) {
  if (!row || row.audit_hard_fail !== true) return []

  const reason =
    typeof row.audit_hard_fail_reason === 'string' && row.audit_hard_fail_reason.trim()
      ? row.audit_hard_fail_reason.trim()
      : 'quality audit VETO (no reason recorded)'

  const found = []
  const seen = new Set()
  for (const key of KNOWN_HARD_FAIL_KEYS) {
    if (key === 'any_hard_fail') continue
    if (reason.includes(key) && !seen.has(key)) {
      seen.add(key)
      found.push({ key, reason })
    }
  }
  if (found.length === 0) {
    const key = /integrity/i.test(reason) ? 'integrity' : 'audit_hard_fail'
    found.push({ key, reason })
  }
  return found
}

/**
 * Prefer evaluateHardFails when an auditor-shaped object exists; otherwise
 * synthesize fails from audit_hard_fail / audit_hard_fail_reason.
 * When checks look clean but audit_hard_fail is still true (integrity /
 * auditError), synthesize so ready/SSE stays aligned with the publish gate.
 * @param {object} row
 * @returns {Array<{ key: string, reason: string }>}
 */
function resolveReviewHardFails(row) {
  if (!row || typeof row !== 'object') return []

  const fromAi =
    row.ai_audit && typeof row.ai_audit === 'object' ? row.ai_audit.hard_fail_checks : null
  const fromTrust =
    row.trust_indicators && typeof row.trust_indicators === 'object'
      ? row.trust_indicators.hard_fail_checks
      : null
  const checks = fromAi || fromTrust
  if (checks && typeof checks === 'object') {
    const audit = { hard_fail_checks: checks }
    const failed = evaluateHardFails(audit, row).failed
    if (failed.length > 0) return failed
    // Integrity / auditor-error vetoes set audit_hard_fail without flipping LLM checks.
    if (row.audit_hard_fail === true) return synthesizeFromAuditHardFail(row)
    return []
  }

  return synthesizeFromAuditHardFail(row)
}

function applyReviewDisclosure(row) {
  const fullArticle = typeof row?.full_article === 'string' ? row.full_article : ''
  const disclaimer = typeof row?.disclaimer === 'string' ? row.disclaimer : ''

  if (hasRiskDisclosure(fullArticle, disclaimer)) {
    return {
      applied: false,
      operator_action:
        'The review already contains a risk / not-financial-advice disclosure (disclaimer or body). Re-audit; if the veto survives, ensure the disclosure is visible in the article body itself.',
    }
  }

  const patch = {}
  const touched = []

  if (!disclaimer.trim()) {
    patch.disclaimer = DISCLOSURE_TEXT
    touched.push('disclaimer')
  }
  if (fullArticle.trim()) {
    patch.full_article = appendDisclosureToHtml(fullArticle)
    touched.push('full_article')
  }

  if (touched.length === 0) {
    return {
      applied: false,
      operator_action:
        'This draft has no article body or disclaimer yet. Run Generate / Polish first, then remediate.',
    }
  }

  return {
    applied: true,
    patch,
    what: `Appended the standard "${DISCLOSURE_HEADING}" disclosure to ${touched.join(' and ')}`,
  }
}

function applyVisualScrub(row) {
  const patch = {}
  let changed = false

  for (const field of SCRUB_STRING_FIELDS) {
    if (typeof row[field] !== 'string') continue
    const next = scrubVisualPlaceholders(row[field])
    if (next !== row[field]) {
      patch[field] = next
      changed = true
    }
  }

  if (Array.isArray(row.red_flags)) {
    const next = scrubArrayItems(row.red_flags, ['flag', 'title', 'detail', 'description'])
    if (JSON.stringify(next) !== JSON.stringify(row.red_flags)) {
      patch.red_flags = next
      changed = true
    }
  }
  if (Array.isArray(row.faq)) {
    const next = scrubArrayItems(row.faq, ['question', 'answer'])
    if (JSON.stringify(next) !== JSON.stringify(row.faq)) {
      patch.faq = next
      changed = true
    }
  }
  if (Array.isArray(row.funnel_stages)) {
    const next = scrubArrayItems(row.funnel_stages, ['title', 'content', 'stat'])
    if (JSON.stringify(next) !== JSON.stringify(row.funnel_stages)) {
      patch.funnel_stages = next
      changed = true
    }
  }
  if (Array.isArray(row.key_takeaways)) {
    const next = row.key_takeaways.map((item) =>
      typeof item === 'string'
        ? scrubVisualPlaceholders(item)
        : scrubArrayItems([item], ['text'])[0],
    )
    if (JSON.stringify(next) !== JSON.stringify(row.key_takeaways)) {
      patch.key_takeaways = next
      changed = true
    }
  }

  if (typeof patch.full_article === 'string') {
    patch.word_count = patch.full_article
      .replace(/<[^>]*>/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length
  }

  return changed
    ? { applied: true, patch, what: 'Removed unresolved visual placeholder tokens from prose fields' }
    : { applied: false, patch: {} }
}

/**
 * Deterministic remediations for review hard fails / gate reasons.
 * @param {object} row
 * @param {Array<{ key: string, reason: string }>} hardFails
 * @param {{ brand?: object, groundTruthNames?: string[] }} [context]
 */
function remediateReviewDeterministic(row, hardFails, context = {}) {
  const patch = {}
  const applied = []
  const unfixable = []
  const fails = Array.isArray(hardFails) ? hardFails : []
  let working = { ...(row || {}) }

  let needsVisualScrub = false
  let ranStructural = false

  for (const fail of fails) {
    const key = fail?.key
    const reason = fail?.reason || 'no reason recorded'
    const reasonBlob = `${key || ''} ${reason}`

    if (key === 'missing_risk_or_ftc_disclosure') {
      const result = applyReviewDisclosure(working)
      if (result.applied) {
        Object.assign(patch, result.patch)
        working = { ...working, ...result.patch }
        applied.push({ key, what: result.what })
      } else {
        unfixable.push({ key, reason, operator_action: result.operator_action })
      }
      continue
    }

    if (/visual placeholder|placeholder-box|\[\s*(chart|diagram|image|infographic|screenshot|photo|step-by-step)\s+needed/i.test(reasonBlob)) {
      needsVisualScrub = true
      continue
    }

    // Structural review remediations (stats tokens, incomplete FAQ, non-evidentiary sources)
    // are safe and cheap — run once when any deterministic fail remains that is not disclosure/visual.
    if (!ranStructural && context.brand) {
      ranStructural = true
      const { review: remReview, report } = remediateReview(working, {
        brand: context.brand,
        groundTruthNames: context.groundTruthNames,
      })
      const structuralKeys = [
        'full_article',
        'how_it_works',
        'summary',
        'verdict',
        'meta_description',
        'red_flags',
        'faq',
        'funnel_stages',
        'key_takeaways',
        'not_for_you',
        'protection_steps',
        'information_gain_summary',
        'headline',
        'item_list',
        'experience_signals',
        'sources',
      ]
      let structuralChanged = false
      for (const f of structuralKeys) {
        if (remReview[f] !== undefined && JSON.stringify(remReview[f]) !== JSON.stringify(working[f])) {
          patch[f] = remReview[f]
          structuralChanged = true
        }
      }
      if (structuralChanged) {
        working = { ...working, ...patch }
        applied.push({
          key: key || 'review_remediate',
          what: `Applied remediateReview (tokenized=${(report.tokenized || []).length}, faq_dropped=${(report.faq_dropped || []).length}, sources_dropped=${(report.sources_dropped || []).length})`,
        })
      }
    }

    // Remaining deterministic keys without a mechanical fix → operator
    if (
      key &&
      key !== 'missing_risk_or_ftc_disclosure' &&
      !/visual placeholder|placeholder-box|\[\s*(chart|diagram|image)/i.test(reasonBlob)
    ) {
      // Already handled structural pass above; mark unfixable only for keys
      // that classify as deterministic but we could not act on (e.g. dead URL
      // without a concrete URL list in the fail payload).
      if (/dead source|blocked.*url|citation_blocked|hard-dead|invalid_citation/i.test(reasonBlob)) {
        unfixable.push({
          key: key || 'dead_citation',
          reason,
          operator_action:
            'Use Auto-Fix / Fix Citations on the review editor with the INVALID_CITATION_URL issues from the publish gate, then re-run Fix & Publish.',
        })
      }
    }
  }

  if (needsVisualScrub) {
    const scrub = applyVisualScrub(working)
    if (scrub.applied) {
      Object.assign(patch, scrub.patch)
      applied.push({ key: 'UNRESOLVED_VISUAL_PLACEHOLDER', what: scrub.what })
    } else {
      unfixable.push({
        key: 'UNRESOLVED_VISUAL_PLACEHOLDER',
        reason: 'Visual placeholder gate reason present but no placeholders found in prose fields',
        operator_action: 'Re-run publish validation; if placeholders remain, scrub them manually in the editor.',
      })
    }
  }

  return { patch, applied, unfixable }
}

/**
 * Load a review row by id.
 * @param {string} id
 */
async function loadReview(id) {
  if (!id || typeof id !== 'string') throw new Error('review id is required')
  const rows = await supaFetch(
    `/reviews?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
  )
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) throw new Error(`Review not found: ${id}`)
  return row
}

async function loadBrandForReview(review) {
  if (!review?.brand_id) return null
  const rows = await supaFetch(
    `/scam_brands?id=eq.${encodeURIComponent(review.brand_id)}&select=*&limit=1`,
  )
  return Array.isArray(rows) ? rows[0] : null
}

function buildReviewAuditPayload(review, brandData) {
  const currentDate = review.review_date || new Date().toISOString().split('T')[0]
  const longevityDays =
    review.trust_indicators?.investigation_period_days ||
    (brandData?.last_seen_at && brandData?.first_seen_at
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
    ...(brandData || {}),
    celebrity_names: dedupeCelebrityList(brandData?.celebrity_list || []),
  }

  const tempSchema = buildReviewSchema({
    reviewContent,
    brandData: brandData || {},
    slug: review.slug,
    currentDate,
    wordCount: review.word_count || 0,
    longevityDays,
    threat: classifyThreat(brandData?.scam_score ?? 0, brandEvidence(brandData), { override: brandData?.classification_override || null }),
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
 * Run the polish-path quality auditor + integrity checks (no visuals/images).
 * @param {object} review
 * @param {object|null} brandData
 */
async function runReviewQualityAudit(review, brandData) {
  const { reviewContent, auditBrandData, tempSchema } = buildReviewAuditPayload(
    review,
    brandData,
  )
  const auditPromptData = qualityAuditorPrompt()
  const auditUserMsg = auditPromptData.userTemplate(
    reviewContent,
    auditBrandData,
    review.sources || [],
    tempSchema,
  )

  let auditResult = null
  let auditError = null
  let auditModelUsed = null

  for (const modelKey of AUDIT_MODELS) {
    try {
      auditResult = await callModel(modelKey, auditPromptData.system, auditUserMsg, {
        jsonMode: true,
        effort: 'high',
        label: 'quality-fix-review-audit',
      })
      break
    } catch (modelErr) {
      auditError = modelErr?.message || String(modelErr)
      if (modelKey === AUDIT_MODELS[AUDIT_MODELS.length - 1]) {
        return { audit: null, auditError, auditModelUsed: null, integrity: null }
      }
    }
  }

  const auditReport = extractJSON(auditResult.text)
  auditModelUsed = auditResult.usedFallback
    ? `${auditResult.resolvedModel} (fallback from ${auditResult.fallbackFrom})`
    : auditResult.label || auditResult.resolvedModel

  const integrity = checkReviewIntegrity({
    review: {
      ...review,
      scam_score: review.scam_score,
      title: review.title,
      full_article: review.full_article,
    },
    brand: brandData || {},
  })

  return { audit: auditReport, auditError: null, auditModelUsed, integrity }
}

function mergeReviewAuditVerdict(review, auditReport, { auditError, auditModelUsed, integrity }) {
  const trust = {
    ...(review.trust_indicators && typeof review.trust_indicators === 'object'
      ? review.trust_indicators
      : {}),
    audit_model: auditModelUsed || trustModelOrNull(review),
    audit_score: auditReport?.overall_score ?? null,
    audit_grade: auditReport?.grade || null,
    audit_critical_fixes: auditReport?.critical_fixes || [],
  }

  if (auditReport?.hard_fail_checks) {
    trust.hard_fail_checks = auditReport.hard_fail_checks
  }

  const llmHardFail = auditReport?.hard_fail_checks?.any_hard_fail === true
  const llmHardFailReason = llmHardFail
    ? auditReport?.hard_fail_checks?.hard_fail_reason ||
      'Quality auditor flagged a hard fail (see critical_fixes).'
    : null

  const integrityOk = !integrity || integrity.ok !== false
  const hardFail = Boolean(auditError) || llmHardFail || !integrityOk
  const hardFailReason = [
    auditError ? `audit failed: ${auditError}` : null,
    llmHardFailReason,
    integrity && !integrity.ok ? integrity.hardFailReason : null,
  ]
    .filter(Boolean)
    .join(' || ') || null

  const ai_audit = {
    overall_score: auditReport?.overall_score ?? null,
    grade: auditReport?.grade || null,
    hard_fail_checks: auditReport?.hard_fail_checks || null,
    critical_fixes: auditReport?.critical_fixes || [],
    audit_error: auditError || null,
    audit_model: auditModelUsed || null,
  }

  return {
    trust_indicators: trust,
    audit_hard_fail: hardFail,
    audit_hard_fail_reason: hardFailReason,
    ai_audit,
  }
}

function trustModelOrNull(review) {
  return review?.trust_indicators?.audit_model || null
}

/**
 * Wire real I/O deps for runQualityFixAgent.
 */
function buildReviewAgentDeps({
  id,
  authorization,
  send,
  origin,
  fetchImpl,
  brand,
  groundTruthNames,
  auditRunner,
} = {}) {
  if (!id) throw new Error('buildReviewAgentDeps requires id')

  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch.bind(globalThis)
  const baseOrigin = resolveOrigin(origin)

  async function runSurgicalModel(prompt) {
    const system =
      prompt && typeof prompt.system === 'string'
        ? prompt.system
        : 'You fix YMYL publish-gate failures surgically. Return JSON only.'
    const user =
      prompt && typeof prompt.user === 'string'
        ? prompt.user
        : typeof prompt === 'string'
          ? prompt
          : JSON.stringify(prompt || {})

    const result = await callQualityFixModel(callModel, system, user, {
      label: 'quality-fix-surgical-review',
    })
    return extractJSON(result.text)
  }

  async function persistPatch(patch) {
    const body = {
      ...(patch && typeof patch === 'object' ? patch : {}),
      updated_at: new Date().toISOString(),
    }
    // Never let callers sneak override-like fields through the patch path.
    delete body.override
    delete body.published_override

    const updated = await supaFetch(
      `/reviews?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      },
    )
    const row = Array.isArray(updated) ? updated[0] : updated
    if (!row) throw new Error('Failed to persist review patch')
    return row
  }

  async function reaudit(workingRow) {
    let brandData = brand
    if (!brandData) brandData = await loadBrandForReview(workingRow)

    const runner = typeof auditRunner === 'function' ? auditRunner : runReviewQualityAudit
    const { audit, auditError, auditModelUsed, integrity } = await runner(
      workingRow,
      brandData,
    )
    const merged = mergeReviewAuditVerdict(workingRow, audit, {
      auditError,
      auditModelUsed,
      integrity,
    })

    await supaFetch(`/reviews?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        trust_indicators: merged.trust_indicators,
        audit_hard_fail: merged.audit_hard_fail,
        audit_hard_fail_reason: merged.audit_hard_fail_reason,
        updated_at: new Date().toISOString(),
      }),
    })

    const row = {
      ...workingRow,
      trust_indicators: merged.trust_indicators,
      audit_hard_fail: merged.audit_hard_fail,
      audit_hard_fail_reason: merged.audit_hard_fail_reason,
      ai_audit: merged.ai_audit,
    }

    const hardFails = resolveReviewHardFails(row)
    return { row, hardFails, audit: merged.ai_audit }
  }

  async function publish() {
    const url = `${baseOrigin}/api/admin/reviews/${encodeURIComponent(id)}/publish`
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization || '',
      },
      // NEVER pass override — only the real publish gate may decide.
      body: JSON.stringify({ action: 'publish' }),
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    return { ok: res.ok, status: res.status, data }
  }

  return {
    remediateDeterministic: (row, hardFails) =>
      remediateReviewDeterministic(row, hardFails, { brand, groundTruthNames }),
    runSurgicalModel,
    applySurgicalPatches,
    researchSourcesForClaims: (opts) =>
      researchSourcesForClaims({
        ...opts,
        callModelFn: callModel,
      }),
    persistPatch,
    reaudit,
    publish,
    send: typeof send === 'function' ? send : () => {},
  }
}

/**
 * Build orchestrator context for a review id.
 */
async function buildReviewAgentContext(id, options = {}) {
  const row = options.row || (await loadReview(id))
  let brand = options.brand || null
  if (!brand && row.brand_id) {
    try {
      brand = await loadBrandForReview(row)
    } catch {
      brand = null
    }
  }
  const groundTruthNames = brand
    ? dedupeCelebrityList(brand.celebrity_list || [])
    : []

  const hardFails = Array.isArray(options.hardFails)
    ? options.hardFails
    : resolveReviewHardFails(row)

  // Attach a synthetic ai_audit so the shared agent can read overall_score.
  const enrichedRow = {
    ...row,
    ai_audit: row.ai_audit || {
      overall_score: row.trust_indicators?.audit_score ?? null,
      hard_fail_checks: row.trust_indicators?.hard_fail_checks || null,
    },
  }

  const wired = buildReviewAgentDeps({
    id,
    authorization: options.authorization,
    send: options.send,
    origin: options.origin,
    fetchImpl: options.fetchImpl,
    brand,
    groundTruthNames,
    auditRunner: options.auditRunner,
  })

  return {
    kind: 'review',
    row: enrichedRow,
    hardFails,
    gateReasons: Array.isArray(options.gateReasons) ? options.gateReasons : [],
    autoPublish: options.autoPublish !== false,
    deps: { ...wired, ...(options.deps || {}) },
  }
}

/**
 * Persist quality_fix onto trust_indicators (reviews have no ai_audit column).
 */
async function persistQualityFixStamp(id, quality_fix, row, stampPersist) {
  const prevTrust =
    row?.trust_indicators && typeof row.trust_indicators === 'object' ? row.trust_indicators : {}
  const trust_indicators = { ...prevTrust, quality_fix }

  if (typeof stampPersist === 'function') {
    return stampPersist(quality_fix, trust_indicators)
  }

  await supaFetch(`/reviews?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      trust_indicators,
      updated_at: new Date().toISOString(),
    }),
  })
  return trust_indicators
}

/**
 * Run one quality-fix cycle for a review row.
 */
async function runReviewQualityFix(id, options = {}) {
  const ctx = await buildReviewAgentContext(id, options)
  const runAgent = typeof options.runAgent === 'function' ? options.runAgent : runQualityFixAgent
  const result = await runAgent(ctx)

  const quality_fix =
    result?.quality_fix || {
      at: new Date().toISOString(),
      model: 'gpt-5.4-mini',
      applied: Array.isArray(result?.applied) ? result.applied : [],
      unfixable: Array.isArray(result?.unfixable) ? result.unfixable : [],
      published: Boolean(result?.published),
      cycle: 1,
    }

  const baseRow = result?.row || ctx.row
  const trust_indicators = await persistQualityFixStamp(
    id,
    quality_fix,
    baseRow,
    options.stampPersist,
  )

  const ai_audit = {
    ...(baseRow.ai_audit && typeof baseRow.ai_audit === 'object' ? baseRow.ai_audit : {}),
    overall_score:
      trust_indicators?.audit_score ??
      baseRow.ai_audit?.overall_score ??
      baseRow.trust_indicators?.audit_score ??
      null,
    quality_fix,
  }

  const row = {
    ...baseRow,
    trust_indicators:
      typeof trust_indicators === 'object' && trust_indicators
        ? trust_indicators
        : { ...(baseRow.trust_indicators || {}), quality_fix },
    ai_audit,
  }

  return {
    ...result,
    quality_fix,
    row,
    audit_summary: {
      ...(result?.audit_summary || {}),
      quality_fix,
      overall_score: ai_audit.overall_score,
    },
  }
}

module.exports = {
  loadReview,
  loadBrandForReview,
  resolveReviewHardFails,
  synthesizeFromAuditHardFail,
  remediateReviewDeterministic,
  buildReviewAgentDeps,
  buildReviewAgentContext,
  runReviewQualityFix,
  runReviewQualityAudit,
  mergeReviewAuditVerdict,
}
