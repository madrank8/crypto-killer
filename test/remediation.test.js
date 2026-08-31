'use strict'

// Tests for the deterministic remediation transforms (lib/remediation.js).
// Sentences are lifted from the live corpus wherever possible — each one is a
// shape the 2026-08-31 dry-run actually had to handle.

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  fixScoreLiterals, fixMetricLiterals, fixRegister, splice,
} = require('../lib/remediation')
const { classifyThreat } = require('../lib/threat-classification')

const DATES = { first_detected_date: '2026-03-13', last_checked_date: '2026-08-13' }

// ─── score literals ───────────────────────────────────────────────────────

test('A1: the old column score is replaced everywhere, unconditionally', () => {
  const log = []
  const out = fixScoreLiterals('Senvix Review — 56/100 Threat Score. Rated 56 / 100 overall.', 56, 47, log, 'title')
  assert.equal(out, 'Senvix Review — 47/100 Threat Score. Rated 47 / 100 overall.')
  assert.equal(log.filter((l) => l.wave === 'A1').length, 2)
})

test('A2: a third value in threat-score context is corrected and itemised', () => {
  const log = []
  const out = fixScoreLiterals("Crest scores 13/100 on Crypto Killer's threat index.", 15, 5, log, 'summary')
  assert.equal(out, "Crest scores 5/100 on Crypto Killer's threat index.")
  assert.equal(log[0].wave, 'A2')
  assert.ok(log[0].context)
})

test('A2: category sub-scores and audit scores are never touched', () => {
  const log = []
  const text = 'Celebrity Impersonation scored 95/100. Audit score 84/100. Campaign Velocity: 60/100.'
  assert.equal(fixScoreLiterals(text, 15, 5, log, 'full_article'), text)
  assert.deepEqual(log, [])
})

test('A2: an N/100 with no scoring context nearby is left alone', () => {
  const log = []
  const text = 'The playlist rated it 90/100 for production quality of the fake videos.'
  assert.equal(fixScoreLiterals(text, 15, 5, log, 'full_article'), text)
})

// ─── metric literals ──────────────────────────────────────────────────────

test('B: a literal split by inline markup is corrected with markup preserved', () => {
  const log = []
  const out = fixMetricLiterals('across <strong>9</strong> countries in total', { countries_targeted: 3 }, log, 'full_article')
  assert.equal(out, 'across <strong>3</strong> countries in total')
})

test('B: a day-count and its stale observation window move together', () => {
  const log = []
  const text = 'over <strong>26 days</strong> of continuous operation between Mar 13, 2026 and Apr 8, 2026. Next sentence.'
  const out = fixMetricLiterals(text, { days_active: 153 }, log, 'full_article', DATES)
  assert.ok(out.includes('153 days'))
  assert.ok(out.includes('between Mar 13, 2026 and Aug 13, 2026'))
  assert.ok(!out.includes('Apr 8'), 'stale end date must not survive next to the corrected count')
})

test('B-skip: a window that does not start at first-detected is left whole', () => {
  const log = []
  const text = 'over 26 days of continuous operation between Jun 1, 2026 and Jul 1, 2026.'
  const out = fixMetricLiterals(text, { days_active: 153 }, log, 'full_article', DATES)
  assert.equal(out, text, 'neither the count nor the window may change')
  assert.equal(log[0].wave, 'B-skip')
})

test('B: platform-scale context is never rewritten', () => {
  const log = []
  const text = 'fingerprinted against a reference database of 12,300 public figures'
  assert.equal(fixMetricLiterals(text, { public_figures_impersonated: 3 }, log, 'methodology'), text)
})

test('B: a correct literal is not "corrected"', () => {
  const log = []
  const text = 'detected across 3 countries'
  assert.equal(fixMetricLiterals(text, { countries_targeted: 3 }, log, 'full_article'), text)
  assert.deepEqual(log, [])
})

// ─── register alignment ───────────────────────────────────────────────────

const LOW = classifyThreat(15)
const UNDER = classifyThreat(30)
const ELEVATED = classifyThreat(45)

test('C1: an unhedged fraud assertion is hedged', () => {
  const log = []
  const out = fixRegister('Key takeaway: TradeGPT is a confirmed investment scam operating in Europe.', UNDER, log, 'full_article')
  assert.equal(out, 'Key takeaway: TradeGPT is a suspected investment scam operating in Europe.')
})

test('C1: the title-case headline gets the strong-evidence register, not "suspected"', () => {
  const log = []
  const out = fixRegister('Quantum AI Is a Confirmed Crypto Scam — Here’s the Evidence', classifyThreat(95), log, 'alternative_headline')
  assert.equal(out, 'Quantum AI Shows Strong Evidence of Crypto Fraud — Here’s the Evidence')
})

test('C1: "is a fraudulent scheme" becomes hallmarks phrasing', () => {
  const log = []
  const out = fixRegister('No. AfriQuant AI is a fraudulent scheme with zero FCA registration.', LOW, log, 'full_article')
  assert.equal(out, 'No. AfriQuant AI displays the hallmarks of a fraudulent scheme with zero FCA registration.')
})

test('C1 guards: negated, attributed, self-referential and question forms survive untouched', () => {
  const log = []
  for (const text of [
    'Affitto does not meet the evidentiary threshold for a confirmed scam.',
    'ScamAdviser rates the site low, stating there is a strong likelihood the website is a scam.',
    'Crypto Killer is a scam intelligence platform.',
    'Whether Peak Luxentria is a scam remains under investigation.',
    'InvestBot has not been designated a confirmed scam by Crypto Killer.',
  ]) {
    assert.equal(fixRegister(text, LOW, log, 'x'), text, text)
  }
  assert.deepEqual(log, [])
})

test('C1: nothing is softened when the register licenses the language', () => {
  const log = []
  const confirmed = classifyThreat(90, { regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB', url: 'https://x' }] })
  const text = 'Acme is a confirmed crypto scam.'
  assert.equal(fixRegister(text, confirmed, log, 'verdict'), text)
})

test('C2: "Do not deposit" is softened below Elevated Risk and kept at or above it', () => {
  const log = []
  const text = 'Final Verdict: exercise caution. Do not deposit any money.'
  const low = fixRegister(text, UNDER, log, 'full_article')
  assert.ok(low.includes('Verify the platform’s regulatory status independently before depositing any money.'))
  assert.ok(!/Do\s+not\s+deposit/i.test(low))
  assert.equal(fixRegister(text, ELEVATED, [], 'full_article'), text)
})

// ─── splice ───────────────────────────────────────────────────────────────

test('splice applies non-overlapping edits and drops overlapping ones', () => {
  assert.equal(splice('abcdef', [{ start: 1, end: 3, replacement: 'X' }, { start: 4, end: 5, replacement: 'Y' }]), 'aXdYf')
  assert.equal(splice('abcdef', [{ start: 1, end: 4, replacement: 'X' }, { start: 2, end: 5, replacement: 'Y' }]), 'aXef')
})

// ── pass-3 regressions (deployed-auditor catches, 2026-08-31) ────────────

test('PASS3: "N ads" stat-card literals are corrected; ad networks and rates are not', () => {
  const log = []
  const out = fixMetricLiterals('<p>173 ads</p> across 12 ad networks, posting 9 new creatives per week.',
    { creatives_observed: 191 }, log, 'full_article')
  assert.ok(out.includes('191 ads'))
  assert.ok(out.includes('12 ad networks'), 'ad networks must not be treated as the catalogue count')
  assert.ok(out.includes('9 new creatives per week'), 'a velocity rate must never become the catalogue total')
})

test('PASS3: "rates X at N/100" counts as score context', () => {
  const log = []
  const out = require('../lib/remediation').fixScoreLiterals(
    'Crypto Killer rates Immediate Bienestar at 29/100 — watchlist status.', 21, 21, log, 'key_takeaways[5]')
  assert.ok(out.includes('21/100'), out)
  assert.equal(log[0].wave, 'A2')
})
