'use strict'

// Corpus-calibrated tests for assertion detection (remediation pass,
// 2026-08-31). Every "passes" case below is a real sentence shape from the
// live archive that an earlier detector version wrongly flagged; every
// "flags" case is a real violation it must keep catching. If one of these
// starts failing, the change is miscalibrated against the actual corpus.

const test = require('node:test')
const assert = require('node:assert/strict')
const { findDefinitiveFraudClaim } = require('../lib/editorial-language')

const LOW = { frameAsScam: false, classification: 'LIMITED_EVIDENCE' }

const NON_ASSERTIVE = [
  ['negated threshold', 'Affitto scores 6/100, indicating low-tier signals that do not meet the evidentiary threshold for a confirmed scam.'],
  ['negated designation', 'InvestBot has not been designated a confirmed scam by Crypto Killer.'],
  ['meta designation', 'Review updated 2026. Hedged — not a confirmed scam designation.'],
  ['corpus reference', "This layered redirection pattern appears in 78% of CryptoKiller's confirmed scam cases."],
  ['open question', 'Whether Peak Luxentria is a scam remains under active investigation.'],
  ['self-description', 'Crypto Killer is a scam intelligence platform powered by ad surveillance.'],
  ['bare "not a"', 'WhatsApp AI scores 35/100 and is classified as watchlist — not a confirmed scam.'],
  ['threshold + classification', 'Current evidence does not meet the threshold for a confirmed scam classification.'],
]

const ASSERTIONS = [
  ['FAQ fraud answer', 'No. AfriQuant AI is a fraudulent scheme built on impersonation.'],
  ['takeaway assertion', 'Key takeaway: TradeGPT is a confirmed investment scam operating across Europe.'],
  ['headline assertion', 'Quantum AI Is a Confirmed Crypto Scam — Here’s the Evidence'],
  ['assertion after unrelated negation', 'The platform has not met the threshold. But separately, Senvix is a confirmed crypto scam that steals deposits.'],
]

for (const [name, text] of NON_ASSERTIVE) {
  test(`non-assertive context passes: ${name}`, () => {
    assert.equal(findDefinitiveFraudClaim(text, LOW), null, text)
  })
}

for (const [name, text] of ASSERTIONS) {
  test(`genuine assertion flagged: ${name}`, () => {
    assert.ok(findDefinitiveFraudClaim(text, LOW), text)
  })
}

test('a later occurrence is scanned even when the first is hedged', () => {
  const text = 'X has not been designated a confirmed scam. Yet the operators run a confirmed scam playbook daily.'
  const hit = findDefinitiveFraudClaim(text, LOW)
  assert.ok(hit)
  assert.equal(hit.kind, 'assertion')
})

test('a conditional deposit directive is the correct low-band register, not a violation', () => {
  assert.equal(findDefinitiveFraudClaim('Do not deposit without independent regulatory verification.', LOW), null)
  assert.equal(findDefinitiveFraudClaim('Do not deposit until the platform is verified by the FCA.', LOW), null)
  const flat = findDefinitiveFraudClaim('Do not deposit any money.', LOW)
  assert.ok(flat)
  assert.equal(flat.kind, 'directive')
})
