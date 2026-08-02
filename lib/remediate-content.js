import {
  DISCLOSURE_HEADING,
  hasRiskDisclosure,
  appendDisclosureToHtml,
  appendDisclosureToSections,
// Imported with its extension, not as `@/lib/...`: webpack resolves both, but
// Node's ESM loader resolves neither the alias nor an extensionless path, and
// this module has to stay loadable under `node --test` for its fixes to be
// testable without a bundler.
} from './ymyl-disclosure.js'

/**
 * Deterministic remediation of quality-audit hard fails.
 *
 * The publish gate can veto a draft for reasons no editor can act on quickly,
 * and the only escape used to be the override, which disables every other check
 * at once. This module closes the gap from the other side: for the failures whose
 * fix is mechanical, it produces the patch; for the rest, it produces a precise
 * statement of what it could not fix and what a human has to do.
 *
 * Two rules make that division safe to automate:
 *
 *   1. Nothing here guesses. A fix is applied only when its correctness is
 *      provable from the row itself. No model is called, no prose is invented,
 *      no claim is edited to match a source.
 *
 *   2. Anything not provably fixable is reported, never silently passed. The
 *      draft stays unpublished and the operator gets the reason.
 */

/**
 * What a human needs to do, per check, when the fix is not mechanical. Written
 * as instructions rather than restatements of the problem: the failure reason
 * already comes from `evaluateHardFails`, and an operator reading a blocked
 * publish needs the next action, not a second description of the block.
 */
const OPERATOR_ACTIONS = {
  fabricated_source_or_stat:
    'Read the audit\'s hard_fail_reason for the exact figure or quote it could not trace. Then either add a source to the ledger that actually states it, or delete the claim from the article. Do not soften the wording and leave the number.',
  fake_or_unmarked_freshness:
    'Either make a substantive update that earns the recency signal, or remove the "updated"/current-year framing and cite a source from the year the article claims.',
  fabricated_reviews_or_testimonials:
    'Remove any invented user review, testimonial, or rating, or replace it with an attributed quote that links to where it was published (FTC 16 CFR 465).',
  commodity_no_information_gain:
    'Add first-party evidence: original data, a dataset, screenshots of the operator, or a firsthand test. This is a content decision, not a formatting one.',
  not_for_you_block_present:
    'Populate the not_for_you field with who this article is NOT for, then regenerate the article so the block renders into the body.',
  item_reviewed_typed:
    'Set item_reviewed.type to FinancialProduct, Service, SoftwareApplication, or Organization. "Thing" is too vague to earn a review rich result.',
  unverified_claims_in_article:
    'For each unsupported claim, add the source that establishes it to the ledger, or remove the claim.',
  source_ledger_claims_without_links:
    'Link each cited ledger claim in the body to its source, so a reader can check it without leaving the sentence.',
  any_hard_fail:
    'The audit vetoed without a readable per-check answer. Re-run the audit; if the veto survives, read hard_fail_reason and fix what it names.',
}

const DEFAULT_OPERATOR_ACTION =
  'Read the audit verdict on this row (ai_audit.hard_fail_checks) and fix what it names, then re-audit.'

/**
 * Apply every mechanical fix warranted by the failing checks.
 *
 * @param {object} row - the `content` row, as loaded from Supabase
 * @param {Array<{ key: string, reason: string }>} hardFails - `evaluateHardFails().failed`
 * @returns {{
 *   patch: object,
 *   applied: Array<{ key: string, what: string }>,
 *   unfixable: Array<{ key: string, reason: string, operator_action: string }>,
 * }}
 */
function remediateContent(row, hardFails) {
  const patch = {}
  const applied = []
  const unfixable = []
  const fails = Array.isArray(hardFails) ? hardFails : []

  for (const fail of fails) {
    const key = fail?.key
    const reason = fail?.reason || 'no reason recorded'

    if (key === 'missing_risk_or_ftc_disclosure') {
      const result = applyDisclosure(row)
      if (result.applied) {
        Object.assign(patch, result.patch)
        applied.push({ key, what: result.what })
      } else {
        unfixable.push({ key, reason, operator_action: result.operator_action })
      }
      continue
    }

    unfixable.push({
      key: key || 'unknown',
      reason,
      operator_action: OPERATOR_ACTIONS[key] || DEFAULT_OPERATOR_ACTION,
    })
  }

  return { patch, applied, unfixable }
}

/**
 * Add the YMYL disclosure to both bodies the site reads.
 *
 * Both are required, and for different readers: `prerender.ts` serves
 * `full_article` to crawlers and only falls back to `sections`, while the client
 * `BlogPostPage` prefers `sections`. Writing one and not the other produces a
 * page where the disclosure appears or vanishes depending on how it was loaded,
 * which for a YMYL disclosure is worse than a consistent absence.
 */
function applyDisclosure(row) {
  const fullArticle = typeof row?.full_article === 'string' ? row.full_article : ''
  const sections = Array.isArray(row?.sections) ? row.sections : []
  const sectionsText = sections.map((s) => `${s?.heading || ''}\n${s?.body || ''}`).join('\n\n')

  if (hasRiskDisclosure(fullArticle, sectionsText)) {
    // The auditor vetoed on a disclosure the article already carries. Appending
    // a second copy would be a visible defect on a live page, so this stops and
    // hands the disagreement to a human — the audit may be describing an older
    // version of the text, which the re-audit that follows will settle.
    return {
      applied: false,
      operator_action:
        'The article already contains a risk / not-financial-advice disclosure, so no block was added. The re-audit will confirm whether the veto was describing an earlier version of the text. If it survives, check that the disclosure is in the article body itself rather than only in a heading or a stray sentence.',
    }
  }

  const patch = {}
  const touched = []

  if (fullArticle.trim()) {
    patch.full_article = appendDisclosureToHtml(fullArticle)
    touched.push('full_article')
  }
  if (sections.length > 0) {
    patch.sections = appendDisclosureToSections(sections)
    touched.push('sections')
  }

  if (touched.length === 0) {
    // Nothing to append to. A draft with no body has not been generated yet, and
    // creating a page whose only content is a disclaimer is not a fix.
    return {
      applied: false,
      operator_action: 'This draft has no article body yet. Run Generate Article first, then remediate.',
    }
  }

  return {
    applied: true,
    patch,
    what: `Appended the standard "${DISCLOSURE_HEADING}" block to ${touched.join(' and ')}`,
  }
}

export { remediateContent, OPERATOR_ACTIONS }
