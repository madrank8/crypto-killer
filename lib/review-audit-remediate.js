/**
 * Deterministic remediation of review quality-audit hard fails.
 *
 * Generation-time cleanup lives in review-remediate.js (stat tokens, roster).
 * This module is the post-veto path: mechanical fixes whose correctness is
 * provable from a fixed allowlist / the row itself. Anything else is reported
 * as unfixable with an operator_action — never silently passed.
 */

const ACTION_FRAUD_SOURCE = Object.freeze({
  url: 'https://www.actionfraud.police.uk/',
  type: 'government',
  title: 'Action Fraud (UK)',
})

const ACTION_FRAUD_DOMAIN = 'actionfraud.police.uk'
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
  missing_risk_or_ftc_disclosure:
    'Add the standard risk / not-financial-advice disclosure to the article body, then re-run Polish.',
}

const DEFAULT_OPERATOR_ACTION =
  'Read the audit hard_fail_reason on this review and fix what it names, then re-run Polish (or Fix & Publish).'

/**
 * @param {string} url
 * @returns {string}
 */
function registrableDomain(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * True when the fail reason / keys implicate the Action Fraud allowlist fix.
 * @param {{ key?: string, reason?: string }} fail
 */
function isActionFraudContactFail(fail) {
  const reason = String(fail?.reason || '')
  const blob = `${fail?.key || ''} ${reason}`.toLowerCase()
  if (/0300\s*123\s*2040/.test(blob)) return true
  if (/action\s*fraud/.test(blob) && /phone|ledger|link|unverified|source_ledger/.test(blob)) {
    return true
  }
  return false
}

/**
 * Split text into segments that are already inside an <a>…</a> vs outside,
 * so we never wrap an already-linked phone / host.
 * @param {string} text
 * @returns {Array<{ linked: boolean, text: string }>}
 */
function splitByAnchors(text) {
  const parts = []
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/gi
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ linked: false, text: text.slice(last, m.index) })
    }
    parts.push({ linked: true, text: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    parts.push({ linked: false, text: text.slice(last) })
  }
  return parts
}

/**
 * Wrap Action Fraud phone / bare host in an official link (outside existing anchors).
 * @param {string} text
 * @returns {{ text: string, changed: boolean }}
 */
function linkActionFraudMentions(text) {
  if (typeof text !== 'string' || !text) {
    return { text, changed: false }
  }

  let changed = false
  const href = ACTION_FRAUD_SOURCE.url
  // Fresh regexes per call — module-level /g keeps lastIndex across invokes.
  const phoneRe = /0300\s*123\s*2040/gi
  const hostRe = /\b(?:www\.)?actionfraud\.police\.uk\b/gi

  // Wrap phones first, then re-split so the new href=... hosts sit inside <a>
  // and are not matched again by the hostname pass.
  let next = splitByAnchors(text)
    .map((part) => {
      if (part.linked) return part.text
      return part.text.replace(phoneRe, (match) => {
        changed = true
        return `<a href="${href}">${match}</a>`
      })
    })
    .join('')

  next = splitByAnchors(next)
    .map((part) => {
      if (part.linked) return part.text
      return part.text.replace(hostRe, (match) => {
        changed = true
        return `<a href="${href}">${match}</a>`
      })
    })
    .join('')

  return { text: next, changed }
}

/**
 * Ensure Action Fraud is on the source ledger (idempotent by domain).
 * @param {Array<object>|undefined} sources
 * @returns {{ sources: Array<object>, added: boolean }}
 */
function upsertActionFraudSource(sources) {
  const list = Array.isArray(sources) ? sources.map((s) => ({ ...s })) : []
  const hasDomain = list.some((s) => registrableDomain(s?.url) === ACTION_FRAUD_DOMAIN)
  if (hasDomain) {
    return { sources: list, added: false }
  }
  list.push({
    ...ACTION_FRAUD_SOURCE,
    accessed_date: new Date().toISOString().slice(0, 10),
  })
  return { sources: list, added: true }
}

/**
 * Apply Action Fraud allowlist fix across faq + full_article + sources.
 * @param {object} row
 * @returns {{ patch: object, what: string[] }}
 */
function applyActionFraudFix(row) {
  const patch = {}
  const what = []

  const { sources, added } = upsertActionFraudSource(row?.sources)
  if (added) {
    patch.sources = sources
    what.push('Added Action Fraud (UK) to the source ledger')
  }

  let faqChanged = false
  if (Array.isArray(row?.faq)) {
    const nextFaq = row.faq.map((item) => {
      if (!item || typeof item !== 'object') return item
      const answer = typeof item.answer === 'string' ? item.answer : ''
      const linked = linkActionFraudMentions(answer)
      if (!linked.changed) return item
      faqChanged = true
      return { ...item, answer: linked.text }
    })
    if (faqChanged) {
      patch.faq = nextFaq
      what.push('Hyperlinked Action Fraud phone/host in FAQ answers')
    }
  }

  if (typeof row?.full_article === 'string' && row.full_article) {
    const linked = linkActionFraudMentions(row.full_article)
    if (linked.changed) {
      patch.full_article = linked.text
      what.push('Hyperlinked Action Fraud phone/host in full_article')
    }
  }

  if (what.length === 0) {
    return { patch: {}, what: [] }
  }

  return { patch, what }
}

/**
 * Infer fail entries from a review row when the caller only has the veto blob.
 * @param {object} review
 * @returns {Array<{ key: string, reason: string }>}
 */
function inferHardFailsFromReview(review) {
  const fails = []
  const reason = review?.audit_hard_fail_reason || ''
  if (reason) {
    const keys = []
    if (/unverified_claims_in_article/i.test(reason)) keys.push('unverified_claims_in_article')
    if (/source_ledger_claims_without_links/i.test(reason)) {
      keys.push('source_ledger_claims_without_links')
    }
    if (keys.length === 0) keys.push('any_hard_fail')
    for (const key of keys) {
      fails.push({ key, reason })
    }
  }

  const critical = review?.trust_indicators?.audit_critical_fixes
  if (Array.isArray(critical)) {
    for (const fix of critical) {
      const text = typeof fix === 'string' ? fix : fix?.issue || fix?.fix || JSON.stringify(fix)
      // Skip critical-fix bullets that are the same Action Fraud contact
      // veto — they are already covered by the reason-derived keys above.
      if (isActionFraudContactFail({ key: 'any_hard_fail', reason: text })) continue
      fails.push({ key: 'any_hard_fail', reason: text })
    }
  }

  return fails
}

/**
 * Apply every mechanical fix warranted by the failing checks.
 *
 * @param {object} row - the `reviews` row (or a subset with sources/faq/full_article)
 * @param {Array<{ key: string, reason: string }>} [hardFails] - optional; inferred from row if omitted
 * @returns {{
 *   patch: object,
 *   applied: Array<{ key: string, what: string }>,
 *   unfixable: Array<{ key: string, reason: string, operator_action: string }>,
 * }}
 */
function remediateReviewAudit(row, hardFails) {
  const patch = {}
  const applied = []
  const unfixable = []
  const fails =
    Array.isArray(hardFails) && hardFails.length > 0
      ? hardFails
      : inferHardFailsFromReview(row)

  let actionFraudApplied = false
  let working = {
    sources: row?.sources,
    faq: row?.faq,
    full_article: row?.full_article,
  }

  for (const fail of fails) {
    const key = fail?.key || 'unknown'
    const reason = fail?.reason || 'no reason recorded'

    if (isActionFraudContactFail(fail)) {
      if (!actionFraudApplied) {
        const result = applyActionFraudFix(working)
        if (result.what.length > 0) {
          Object.assign(patch, result.patch)
          working = { ...working, ...result.patch }
          for (const w of result.what) {
            applied.push({ key, what: w })
          }
          actionFraudApplied = true
        }
      }
      continue
    }

    unfixable.push({
      key,
      reason,
      operator_action: OPERATOR_ACTIONS[key] || DEFAULT_OPERATOR_ACTION,
    })
  }

  return { patch, applied, unfixable }
}

module.exports = {
  remediateReviewAudit,
  inferHardFailsFromReview,
  ACTION_FRAUD_SOURCE,
  OPERATOR_ACTIONS,
  isActionFraudContactFail,
  linkActionFraudMentions,
  upsertActionFraudSource,
}
