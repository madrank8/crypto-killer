const { test } = require('node:test'); const assert = require('node:assert/strict')
const { evaluateHardFails } = require('../lib/audit-gate')

/** A verdict where every check passes. */
function passingChecks(overrides = {}) {
  return {
    unverified_claims_in_article: 0,
    not_for_you_block_present: true,
    source_ledger_claims_without_links: 0,
    item_reviewed_typed: true,
    claims_appearance_populated: 'pass',
    fabricated_source_or_stat: false,
    fake_or_unmarked_freshness: false,
    fabricated_reviews_or_testimonials: false,
    missing_risk_or_ftc_disclosure: false,
    commodity_no_information_gain: false,
    any_hard_fail: false,
    hard_fail_reason: null,
    ...overrides,
  }
}

const reviewRow = { item_reviewed: { type: 'FinancialProduct', name: 'Kraken' } }
const blogRow = { item_reviewed: null }

test('a fully passing verdict blocks nothing', () => {
  const r = evaluateHardFails({ hard_fail_checks: passingChecks() }, reviewRow)
  assert.deepEqual(r.failed, [])
  assert.equal(r.any_hard_fail, false)
})

test('a missing verdict is not a failure', () => {
  // Legacy rows predate the content auditor entirely. Blocking on absence
  // would retroactively trap every already-published article on republish.
  assert.equal(evaluateHardFails(null, blogRow).any_hard_fail, false)
  assert.equal(evaluateHardFails({}, blogRow).any_hard_fail, false)
  assert.equal(evaluateHardFails({ hard_fail_checks: null }, blogRow).any_hard_fail, false)
})

test('a real fabrication finding blocks', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      fabricated_source_or_stat: true,
      any_hard_fail: true,
      hard_fail_reason: 'the 73% figure traces to no source',
    }),
  }, reviewRow)

  assert.equal(r.any_hard_fail, true)
  assert.deepEqual(r.failed.map((f) => f.key), ['fabricated_source_or_stat'])
})

test('a missing not-for-you block blocks (false is the failing value)', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ not_for_you_block_present: false }),
  }, reviewRow)

  assert.deepEqual(r.failed.map((f) => f.key), ['not_for_you_block_present'])
})

test('counts above zero block and the count appears in the reason', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ unverified_claims_in_article: 3 }),
  }, reviewRow)

  assert.deepEqual(r.failed.map((f) => f.key), ['unverified_claims_in_article'])
  assert.match(r.failed[0].reason, /^3 /)
})

test('a count emitted as a numeric string is still read as a count', () => {
  const zero = evaluateHardFails({ hard_fail_checks: passingChecks({ unverified_claims_in_article: '0' }) }, reviewRow)
  assert.deepEqual(zero.failed, [])

  const two = evaluateHardFails({ hard_fail_checks: passingChecks({ unverified_claims_in_article: '2' }) }, reviewRow)
  assert.deepEqual(two.failed.map((f) => f.key), ['unverified_claims_in_article'])
})

// ─── The bug this module exists to fix ───

test('item_reviewed_typed is skipped on a row with no reviewed entity', () => {
  // The blog-post false positive: the check inspects item_reviewed.type, blog
  // rows have no item_reviewed, so it failed on every blog post and the only
  // escape was an override that disabled every other check too.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      item_reviewed_typed: false,
      any_hard_fail: true,
      hard_fail_reason: 'item_reviewed is not typed',
    }),
  }, blogRow)

  assert.equal(r.any_hard_fail, false, 'a check with nothing to inspect must not block')
  assert.deepEqual(r.skipped.map((s) => s.key), ['item_reviewed_typed'])
  assert.ok(
    r.warnings.some((w) => w.includes('item_reviewed is not typed')),
    'the auditor\'s stated reason is surfaced so the operator can sanity-check the skip',
  )
})

test('an empty item_reviewed object counts as absent', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ item_reviewed_typed: false }),
  }, { item_reviewed: {} })

  assert.equal(r.any_hard_fail, false)
})

test('item_reviewed_typed still blocks on a row that DOES have a reviewed entity', () => {
  // The skip must be scoped to inapplicability. On review content the check is
  // meaningful and a mistyped entity breaks the review schema.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ item_reviewed_typed: false }),
  }, { item_reviewed: { type: 'Thing' } })

  assert.deepEqual(r.failed.map((f) => f.key), ['item_reviewed_typed'])
})

test('a check the auditor marks n/a is skipped, not failed', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ item_reviewed_typed: 'n/a', any_hard_fail: true }),
  }, blogRow)

  assert.equal(r.any_hard_fail, false)
})

// ─── Echoed prompt text ───

test('an echoed prompt description is a non-answer, not a pass', () => {
  // Left as-is this reads truthy, so the check silently reports a pass on a
  // question that was never answered.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      not_for_you_block_present: 'BOOLEAN — TRUE when the block is present. FALSE = HARD FAIL.',
    }),
  }, reviewRow)

  assert.deepEqual(r.failed, [], 'a non-answer is not evidence of failure')
  assert.deepEqual(r.skipped.map((s) => s.key), ['not_for_you_block_present'])
  assert.ok(r.warnings.some((w) => w.includes('not_for_you_block_present')))
})

test('an echoed prompt description is a non-answer, not a fabrication', () => {
  // The inverse inversion: read truthy, this fails a fail-when-true check and
  // accuses a clean article of fabricating sources.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      fabricated_source_or_stat: 'BOOLEAN — TRUE if any statistic, quote, study, or source appears invented.',
    }),
  }, reviewRow)

  assert.deepEqual(r.failed, [])
  assert.deepEqual(r.skipped.map((s) => s.key), ['fabricated_source_or_stat'])
})

// ─── Disagreement with the auditor's own summary flag ───

test('a self-reported veto with unreadable checks blocks, because it cannot be ruled out', () => {
  // The veto cannot be attributed to a check, but it also cannot be cleared.
  // Publishing on an unreadable audit would be guessing on a YMYL page.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      fabricated_source_or_stat: 'BOOLEAN — TRUE if any statistic appears invented.',
      any_hard_fail: true,
      hard_fail_reason: 'the 95% recovery rate is unsourced',
    }),
  }, reviewRow)

  assert.equal(r.any_hard_fail, true)
  assert.deepEqual(r.failed.map((f) => f.key), ['any_hard_fail'])
  assert.match(r.failed[0].reason, /the 95% recovery rate is unsourced/)
  assert.match(r.failed[0].reason, /Re-run the audit/)
})

test('a self-reported veto with all checks readable and passing does not block', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ any_hard_fail: true, hard_fail_reason: 'something felt off' }),
  }, reviewRow)

  assert.equal(r.any_hard_fail, false)
  assert.ok(r.warnings.some((w) => w.includes('something felt off')))
})

test('a self-reported PASS does not suppress a check that actually failed', () => {
  // The individual keys are the authority in both directions. A model that
  // forgets to roll a failure up into any_hard_fail must not get a free pass.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ missing_risk_or_ftc_disclosure: true, any_hard_fail: false }),
  }, reviewRow)

  assert.equal(r.any_hard_fail, true)
  assert.deepEqual(r.failed.map((f) => f.key), ['missing_risk_or_ftc_disclosure'])
})

test('multiple independent failures are all reported', () => {
  // The operator needs the full list to fix in one pass, not one error at a time.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      missing_risk_or_ftc_disclosure: true,
      commodity_no_information_gain: true,
      not_for_you_block_present: false,
    }),
  }, reviewRow)

  assert.deepEqual(r.failed.map((f) => f.key).sort(), [
    'commodity_no_information_gain',
    'missing_risk_or_ftc_disclosure',
    'not_for_you_block_present',
  ])
})

test('every failure carries an actionable reason', () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({
      fabricated_source_or_stat: true,
      fake_or_unmarked_freshness: true,
      fabricated_reviews_or_testimonials: true,
      missing_risk_or_ftc_disclosure: true,
      commodity_no_information_gain: true,
      not_for_you_block_present: false,
      item_reviewed_typed: false,
      unverified_claims_in_article: 1,
      source_ledger_claims_without_links: 1,
    }),
  }, reviewRow)

  assert.equal(r.failed.length, 9, 'all nine hard-fail checks are wired up')
  for (const f of r.failed) {
    assert.ok(f.reason && f.reason.length > 20, `${f.key} has no usable reason`)
  }
})

// ─── claims_appearance_populated stays soft ───

test("claims_appearance_populated 'warn' is a warning, not a block", () => {
  // Soft during the Fact Check Explorer backfill: missing appearance URLs cost
  // visibility, they do not make the page unpublishable.
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ claims_appearance_populated: 'warn' }),
  }, reviewRow)

  assert.equal(r.any_hard_fail, false)
  assert.ok(r.warnings.some((w) => w.includes('appearance URL')))
})

test("claims_appearance_populated 'pass_no_source' is silent", () => {
  const r = evaluateHardFails({
    hard_fail_checks: passingChecks({ claims_appearance_populated: 'pass_no_source' }),
  }, reviewRow)

  assert.deepEqual(r.warnings, [])
})
