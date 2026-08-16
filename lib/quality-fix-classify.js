const OPERATOR_ACTIONS = {
  commodity_no_information_gain:
    'Add first-party evidence: original data, screenshots, or a firsthand test. This is a content decision, not a formatting one.',
  unknown:
    'Read the audit hard_fail_reason and fix what it names, then re-run Fix & Publish.',
}

const DETERMINISTIC_KEYS = new Set(['missing_risk_or_ftc_disclosure', 'source_ledger_claims_without_links'])
const SURGICAL_KEYS = new Set([
  'fabricated_source_or_stat',
  'fabricated_reviews_or_testimonials',
  'fake_or_unmarked_freshness',
  'not_for_you_block_present',
])
const RESEARCH_CANDIDATE_KEYS = new Set([
  'unverified_claims_in_article',
])
const UNFIXABLE_KEYS = new Set(['commodity_no_information_gain'])
const SKIP_KEYS = new Set(['item_reviewed_typed'])

function classifyFromReasonText(text) {
  const t = String(text || '').toLowerCase()
  if (/visual placeholder|placeholder-box|\[.*needed/i.test(t)) return 'deterministic'
  if (/dead source|blocked.*url|citation_blocked|hard-dead/i.test(t)) return 'deterministic'
  if (/skeleton|taxonomy trailer|minimum 40|placeholder target_slug|author_bio leads|anti-slop|banned phrase/i.test(t)) {
    return 'surgical'
  }
  if (/verify\}\}|unverified claim|not supported by any source/i.test(t)) return 'research_candidate'
  return null
}

function classifyFail(fail = {}, gateReason) {
  const key = fail.key || 'unknown'
  const reasonBlob = [fail.reason, gateReason].filter(Boolean).join(' ')

  if (SKIP_KEYS.has(key)) return { key, tactic: 'skip' }
  if (DETERMINISTIC_KEYS.has(key)) return { key, tactic: 'deterministic' }
  if (UNFIXABLE_KEYS.has(key)) {
    return { key, tactic: 'unfixable', operator_action: OPERATOR_ACTIONS[key] || OPERATOR_ACTIONS.unknown }
  }
  if (RESEARCH_CANDIDATE_KEYS.has(key)) return { key, tactic: 'research_candidate' }
  if (SURGICAL_KEYS.has(key)) return { key, tactic: 'surgical' }

  const fromReason = classifyFromReasonText(reasonBlob)
  if (fromReason) return { key, tactic: fromReason, reason: reasonBlob }

  return {
    key,
    tactic: 'unfixable',
    operator_action: OPERATOR_ACTIONS[key] || OPERATOR_ACTIONS.unknown,
    reason: fail.reason || gateReason || 'unrecognized quality gate failure',
  }
}

function classifyFails(fails = [], gateReasons = []) {
  const fromFails = (Array.isArray(fails) ? fails : []).map((f) => classifyFail(f))
  const fromGates = (Array.isArray(gateReasons) ? gateReasons : []).map((r, i) =>
    classifyFail({ key: `gate_${i}`, reason: r }, r),
  )
  return [...fromFails, ...fromGates]
}

module.exports = { classifyFail, classifyFails, OPERATOR_ACTIONS }
