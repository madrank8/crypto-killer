const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classifyFail, classifyFails } = require('../lib/quality-fix-classify')

test('disclosure → deterministic', () => {
  assert.equal(classifyFail({ key: 'missing_risk_or_ftc_disclosure' }).tactic, 'deterministic')
})

test('unverified claims → research_candidate', () => {
  assert.equal(classifyFail({ key: 'unverified_claims_in_article' }).tactic, 'research_candidate')
})

test('source ledger claims without links → deterministic', () => {
  assert.equal(classifyFail({ key: 'source_ledger_claims_without_links' }).tactic, 'deterministic')
})

test('commodity → unfixable with operator_action', () => {
  const c = classifyFail({ key: 'commodity_no_information_gain', reason: 'no IG' })
  assert.equal(c.tactic, 'unfixable')
  assert.match(c.operator_action, /first-party|original data|firsthand/i)
})

test('fabricated stat → surgical', () => {
  assert.equal(classifyFail({ key: 'fabricated_source_or_stat' }).tactic, 'surgical')
})

test('gate reason with skeleton opener → surgical', () => {
  assert.equal(
    classifyFail({}, "section \"Intro\" body opens with a skeleton meta-description").tactic,
    'surgical',
  )
})

test('unknown key → unfixable', () => {
  assert.equal(classifyFail({ key: 'some_future_check' }).tactic, 'unfixable')
})

test('classifyFails preserves order and keys', () => {
  const out = classifyFails([
    { key: 'missing_risk_or_ftc_disclosure' },
    { key: 'commodity_no_information_gain' },
  ])
  assert.equal(out[0].tactic, 'deterministic')
  assert.equal(out[1].tactic, 'unfixable')
})
