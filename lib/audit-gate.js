/**
 * Interprets the quality auditor's `hard_fail_checks` object into a publish
 * decision.
 *
 * The publish gate used to read one field — `hard_fail_checks.any_hard_fail` —
 * and block on it. Two failure modes made that untrustworthy:
 *
 *   1. Checks that do not apply. `item_reviewed_typed` inspects
 *      `item_reviewed.type`, which only review content has. Blog rows have no
 *      `item_reviewed` at all, so the check failed on every blog post and the
 *      model rolled that into `any_hard_fail: true`. The article was fine; the
 *      question was wrong. The only escape was the override, which disables
 *      every other check too.
 *
 *   2. Echoed prompt text. The prompt documents each key with a description
 *      string ("BOOLEAN — TRUE if ..."). Models sometimes return the
 *      description instead of a value. A truthy string reads as `true`, which
 *      silently inverts checks: `not_for_you_block_present` looks like a pass
 *      and `fabricated_source_or_stat` looks like a fabrication. Neither is an
 *      answer.
 *
 * So `any_hard_fail` is treated as the model's opinion, not the verdict. The
 * verdict is recomputed from the individual keys, values are parsed strictly,
 * and anything unreadable is reported as a non-answer rather than guessed at.
 */

/**
 * Checks whose failing value is `true`.
 */
const FAIL_WHEN_TRUE = {
  fabricated_source_or_stat:
    'the auditor found a statistic, quote, study, or source it could not trace to the source ledger (YMYL fabrication)',
  fake_or_unmarked_freshness:
    'the article fakes a recency signal — a "last updated" date with no substantive change, or a current-year claim with no current-year source',
  fabricated_reviews_or_testimonials:
    'the article presents invented user reviews, testimonials, or ratings as real (FTC 16 CFR 465)',
  missing_risk_or_ftc_disclosure:
    'this YMYL/financial page makes a recommendation or material claim without the required risk framing / not-financial-advice disclosure',
  commodity_no_information_gain:
    'the article is commodity content — no first-party evidence, original data, or firsthand investigation beyond a generic top-10 result (Sullivan test)',
}

/**
 * Checks whose failing value is `false`.
 */
const FAIL_WHEN_FALSE = {
  not_for_you_block_present:
    'the "who this is not for" block is missing — required so the page disqualifies the wrong reader instead of converting them',
  item_reviewed_typed:
    'item_reviewed.type is "Thing" or missing; it must be FinancialProduct, Service, SoftwareApplication, or Organization for the review schema to be valid',
}

/**
 * Checks whose failing value is a count above zero.
 */
const FAIL_WHEN_POSITIVE = {
  unverified_claims_in_article:
    'claim(s) in the article are not supported by any source in the ledger',
  source_ledger_claims_without_links:
    'ledger claim(s) are cited in the body with no link to the source',
}

/**
 * Parse a value that is supposed to be a boolean.
 *
 * Returns `true`/`false` for a real answer, `'n/a'` when the auditor declared
 * the check inapplicable, and `null` for anything else — including echoed
 * prompt descriptions. `null` means "no answer given", which is deliberately
 * different from "answered false".
 */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  const v = value.trim().toLowerCase()
  if (v === 'true' || v === 'yes' || v === 'pass') return true
  if (v === 'false' || v === 'no' || v === 'fail') return false
  if (v === 'n/a' || v === 'na' || v === 'not_applicable') return 'n/a'
  return null
}

/**
 * Parse a value that is supposed to be a count. Strings are accepted because
 * models emit "0" as often as 0; non-numeric strings are non-answers.
 */
function parseCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  if (typeof value === 'string' && value.trim().toLowerCase() === 'n/a') return 'n/a'
  return null
}

/**
 * True when the row has no reviewed entity, so review-only schema checks have
 * nothing to inspect. An empty object counts as absent: `{}` has no `.type`
 * either, and failing a check against a placeholder is the same false positive
 * as failing it against a missing column.
 */
function hasItemReviewed(row) {
  const item = row?.item_reviewed
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  return Object.keys(item).length > 0
}

/**
 * @param {object|null} audit - the persisted `content.ai_audit` verdict
 * @param {object} row - the `content` row the verdict describes
 * @returns {{
 *   failed: Array<{ key: string, reason: string }>,
 *   skipped: Array<{ key: string, why: string }>,
 *   warnings: string[],
 *   any_hard_fail: boolean,
 * }}
 */
export function evaluateHardFails(audit, row) {
  const failed = []
  const skipped = []
  const warnings = []

  const checks = audit?.hard_fail_checks
  if (!checks || typeof checks !== 'object') {
    // No verdict to interpret. Absence is not a failure — see the publish
    // gate's note on legacy rows.
    return { failed, skipped, warnings, any_hard_fail: false }
  }

  // Review-only checks are skipped on rows that carry no reviewed entity,
  // before their values are even read. The check is not lenient here; it is
  // inapplicable, and an inapplicable check has no verdict to give.
  const reviewOnlySkipped = new Set()
  if (!hasItemReviewed(row)) {
    reviewOnlySkipped.add('item_reviewed_typed')
    if ('item_reviewed_typed' in checks) {
      skipped.push({
        key: 'item_reviewed_typed',
        why: 'this row has no item_reviewed entity (blog/editorial content), so there is no schema type to validate',
      })
    }
  }

  /** Records a key whose value could not be read as an answer. */
  const nonAnswer = (key) => {
    skipped.push({ key, why: 'the auditor returned an unreadable value (likely echoed prompt text) instead of an answer' })
    warnings.push(`quality audit check "${key}" has no readable value — re-run the audit to get a real answer for it`)
  }

  for (const [key, reason] of Object.entries(FAIL_WHEN_TRUE)) {
    if (!(key in checks)) continue
    const parsed = parseBoolean(checks[key])
    if (parsed === null) nonAnswer(key)
    else if (parsed === 'n/a') skipped.push({ key, why: 'the auditor marked this check not applicable' })
    else if (parsed === true) failed.push({ key, reason })
  }

  for (const [key, reason] of Object.entries(FAIL_WHEN_FALSE)) {
    if (!(key in checks)) continue
    if (reviewOnlySkipped.has(key)) continue
    const parsed = parseBoolean(checks[key])
    if (parsed === null) nonAnswer(key)
    else if (parsed === 'n/a') skipped.push({ key, why: 'the auditor marked this check not applicable' })
    else if (parsed === false) failed.push({ key, reason })
  }

  for (const [key, reason] of Object.entries(FAIL_WHEN_POSITIVE)) {
    if (!(key in checks)) continue
    const parsed = parseCount(checks[key])
    if (parsed === null) nonAnswer(key)
    else if (parsed === 'n/a') skipped.push({ key, why: 'the auditor marked this check not applicable' })
    else if (parsed > 0) failed.push({ key, reason: `${parsed} ${reason}` })
  }

  // claims_appearance_populated is a soft signal during the Fact Check
  // Explorer backfill: 'warn' means visibility was left on the table, not that
  // the article is unpublishable. Kept a warning here on purpose — promoting it
  // to a hard fail is a separate decision, not a side effect of this refactor.
  const appearance = typeof checks.claims_appearance_populated === 'string'
    ? checks.claims_appearance_populated.trim().toLowerCase()
    : null
  if (appearance === 'warn') {
    warnings.push('quality audit: one or more claims have no appearance URL despite verified landing URLs being available — Fact Check Explorer visibility is being left unused')
  }

  // The model's own summary flag. It is not the verdict, but a disagreement is
  // information: the model may have seen something none of the keys encode.
  const selfReported = parseBoolean(checks.any_hard_fail) === true
  if (selfReported && failed.length === 0) {
    const unreadable = skipped.some((s) => s.why.startsWith('the auditor returned an unreadable value'))
    const stated = typeof checks.hard_fail_reason === 'string' && checks.hard_fail_reason.trim()
      ? checks.hard_fail_reason.trim()
      : null

    if (unreadable) {
      // Cannot attribute the veto to any specific check, and cannot rule it
      // out either. Blocking is the only honest option.
      failed.push({
        key: 'any_hard_fail',
        reason: `the audit reports a veto${stated ? ` (${stated})` : ''} but its individual checks are unreadable, so the finding cannot be confirmed or cleared. Re-run the audit.`,
      })
    } else {
      // Every check either passed or does not apply to this row, so the
      // model's veto was attributable to an inapplicable check.
      warnings.push(
        `quality audit set any_hard_fail but every applicable check passed${stated ? ` — its stated reason was: "${stated}"` : ''}. Treated as a pass because the failing check does not apply to this content type.`,
      )
    }
  }

  return { failed, skipped, warnings, any_hard_fail: failed.length > 0 }
}
