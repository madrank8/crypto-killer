'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BANDS,
  classifyThreat,
  normalizeScore,
  bandForScore,
  evaluateCorroboration,
} = require('../lib/threat-classification')

const REGULATOR = { regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB', url: 'https://fca.org.uk/x' }] }

test('bands cover 0-100 with no gap or overlap', () => {
  const sorted = [...BANDS].sort((a, b) => a.min - b.min)
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 100)
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i].min, sorted[i - 1].max + 1, `gap between ${sorted[i - 1].classification} and ${sorted[i].classification}`)
  }
})

test('score boundaries map to the documented classification', () => {
  const expected = [
    [0, 'LIMITED_EVIDENCE'],
    [19, 'LIMITED_EVIDENCE'],
    [20, 'UNDER_INVESTIGATION'],
    [39, 'UNDER_INVESTIGATION'],
    [40, 'ELEVATED_RISK'],
    [59, 'ELEVATED_RISK'],
    [60, 'HIGH_RISK'],
    [79, 'HIGH_RISK'],
    [80, 'CONFIRMED'],
    [100, 'CONFIRMED'],
  ]
  for (const [score, classification] of expected) {
    assert.equal(bandForScore(score).classification, classification, `raw band for ${score}`)
  }
})

test('80 and 100 classify as CONFIRMED only when the evidentiary test is met', () => {
  for (const score of [80, 90, 100]) {
    assert.equal(classifyThreat(score, REGULATOR).classification, 'CONFIRMED')
    assert.equal(classifyThreat(score, REGULATOR).frameAsScam, true)
  }
})

test('a confirmed-band score with no corroboration is presented as HIGH_RISK', () => {
  const t = classifyThreat(95, null)
  assert.equal(t.scoreBand, 'CONFIRMED')
  assert.equal(t.classification, 'HIGH_RISK')
  assert.equal(t.frameAsScam, false)
  assert.equal(t.downgraded, true)
  assert.ok(Array.isArray(t.evidenceShortfall) && t.evidenceShortfall.length === 3)
  // The real score is preserved — only the language is constrained.
  assert.equal(t.score, 95)
})

test('definitive fraud language is never permitted below the confirmed band', () => {
  for (const score of [0, 19, 20, 39, 40, 59, 60, 79]) {
    assert.equal(classifyThreat(score, REGULATOR).frameAsScam, false, `score ${score}`)
  }
})

test('each of the three methodology tests independently unlocks CONFIRMED', () => {
  const cases = [
    REGULATOR,
    { regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB' }, { regulator: 'BaFin', jurisdiction: 'DE' }] },
    { victim_reports: { count: 4 } },
  ]
  for (const evidence of cases) {
    assert.equal(classifyThreat(88, evidence).classification, 'CONFIRMED')
  }
})

test('victim reports count from a number, an array or an object', () => {
  assert.equal(evaluateCorroboration({ victim_reports: 3 }).satisfied, true)
  assert.equal(evaluateCorroboration({ victim_reports: [{}, {}] }).satisfied, true)
  assert.equal(evaluateCorroboration({ victim_reports: { count: 1 } }).satisfied, true)
  assert.equal(evaluateCorroboration({ victim_reports: { count: 0 } }).satisfied, false)
  assert.equal(evaluateCorroboration({}).satisfied, false)
})

test('invalid scores are reported, not silently treated as zero', () => {
  for (const bad of [null, undefined, NaN, '55', {}, [], Infinity]) {
    const n = normalizeScore(bad)
    assert.equal(n.valid, false, `${String(bad)} should be invalid`)
    assert.equal(classifyThreat(bad).scoreValid, false)
  }
})

test('out-of-range scores clamp for rendering but stay flagged', () => {
  const high = classifyThreat(140, REGULATOR)
  assert.equal(high.score, 100)
  assert.equal(high.scoreValid, false)
  assert.equal(high.scoreIssue, 'out_of_range')

  const low = classifyThreat(-12)
  assert.equal(low.score, 0)
  assert.equal(low.scoreValid, false)
  assert.equal(low.classification, 'LIMITED_EVIDENCE')
})

test('an editorial override may tighten the register', () => {
  const t = classifyThreat(70, null, {
    override: { classification: 'UNDER_INVESTIGATION', reason: 'sole source retracted', analyst: 'webb' },
  })
  assert.equal(t.classification, 'UNDER_INVESTIGATION')
  assert.equal(t.override.analyst, 'webb')
  assert.equal(t.override.refused, undefined)
})

test('an editorial override may NOT loosen the register', () => {
  const t = classifyThreat(30, null, {
    override: { classification: 'CONFIRMED', reason: 'gut feel', analyst: 'webb' },
  })
  assert.equal(t.classification, 'UNDER_INVESTIGATION')
  assert.equal(t.frameAsScam, false)
  assert.equal(t.override.refused, true)
  assert.match(t.override.refusedBecause, /would raise the register/)
})

test('an unattributed or unexplained override is ignored', () => {
  assert.equal(classifyThreat(70, null, { override: { classification: 'LIMITED_EVIDENCE' } }).classification, 'HIGH_RISK')
  assert.equal(classifyThreat(70, null, { override: { classification: 'LIMITED_EVIDENCE', reason: 'x' } }).classification, 'HIGH_RISK')
  assert.equal(classifyThreat(70, null, { override: { classification: 'NOT_A_BAND', reason: 'x', analyst: 'y' } }).classification, 'HIGH_RISK')
})

test('lib/threat-score re-exports the same implementation', () => {
  const legacy = require('../lib/threat-score')
  assert.equal(legacy.classifyThreat(56).classification, classifyThreat(56).classification)
  assert.equal(legacy.TIERS.length, BANDS.length)
})

test('REVIEW FIX: brandEvidence plucks the gate columns off a brand row', () => {
  const { brandEvidence } = require('../lib/threat-classification')
  const e = brandEvidence({ regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB' }], victim_reports: { count: 2 }, name: 'x' })
  assert.equal(classifyThreat(85, e).classification, 'CONFIRMED')
  assert.equal(brandEvidence(null), null)
  assert.equal(classifyThreat(85, brandEvidence({})).classification, 'HIGH_RISK')
})
