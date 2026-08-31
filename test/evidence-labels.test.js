'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EVIDENCE_CLASS_KEYS,
  classifyEvidence,
  isKnownEvidenceClass,
  normalizeEvidenceItems,
  derivedObservedFindings,
} = require('../lib/evidence-labels')
const { buildInvestigation } = require('../lib/investigation-model')

test('exactly the four documented classes exist', () => {
  assert.deepEqual([...EVIDENCE_CLASS_KEYS].sort(), ['INFERRED', 'OBSERVED', 'REGULATORY', 'REPORTED'])
})

test('an unknown or missing class falls back DOWN to INFERRED, never up to OBSERVED', () => {
  for (const bad of [undefined, null, '', 'OBSERVEDD', 'verified', 42, {}]) {
    assert.equal(classifyEvidence(bad).key, 'INFERRED', String(bad))
  }
})

test('case and whitespace do not change the class', () => {
  assert.equal(classifyEvidence('  observed ').key, 'OBSERVED')
  assert.equal(classifyEvidence('Regulatory').key, 'REGULATORY')
})

test('only OBSERVED and REGULATORY may state a finding as fact', () => {
  assert.equal(classifyEvidence('OBSERVED').assertsFact, true)
  assert.equal(classifyEvidence('REGULATORY').assertsFact, true)
  assert.equal(classifyEvidence('REPORTED').assertsFact, false)
  assert.equal(classifyEvidence('INFERRED').assertsFact, false)
})

test('a mislabelled class is preserved for reporting even after downgrade', () => {
  const [item] = normalizeEvidenceItems([{ claim: 'x claim', evidence_class: 'OBSERVEDD' }])
  assert.equal(item.evidence_class, 'INFERRED')
  assert.equal(item.declared_class, 'OBSERVEDD')
  assert.equal(item.class_recognised, false)
  assert.equal(isKnownEvidenceClass('OBSERVEDD'), false)
})

test('items with no claim text are dropped', () => {
  assert.equal(normalizeEvidenceItems([{ evidence_class: 'OBSERVED' }, { claim: '   ' }]).length, 0)
})

test('non-http source URLs are rejected rather than rendered', () => {
  const [item] = normalizeEvidenceItems([{ claim: 'c', source_url: 'javascript:alert(1)' }])
  assert.equal(item.source_url, null)
})

test('derived findings name their subject and quote canonical numbers only', () => {
  const investigation = buildInvestigation({
    review: { id: 'r', slug: 'senvix', scam_score: 56, author_name: 'X' },
    brand: {
      id: 'b', name: 'Senvix', scam_score: 56,
      first_seen_at: '2025-09-09', last_seen_at: '2026-08-13',
      total_creatives: 1278, total_celebrities: 2, celebrity_list: ['Elon Musk', 'Bill Gates'], geo_list: ['GB', 'DE'],
    },
  })
  const findings = derivedObservedFindings(investigation)
  const byMetric = Object.fromEntries(findings.map((f) => [f.metric_key, f]))

  assert.match(byMetric.creatives_observed.claim, /^Crypto Killer catalogued 1,278 advertising creatives promoting Senvix/)
  assert.equal(byMetric.creatives_observed.evidence_class, 'OBSERVED')
  assert.match(byMetric.countries_targeted.claim, /^Senvix advertising was observed targeting 2 countries/)
  // Longevity is a span we compute, not something we watched happen.
  assert.equal(byMetric.days_active.evidence_class, 'INFERRED')
  for (const f of findings) {
    assert.doesNotMatch(f.claim, /^(It|They|This platform)\b/, `"${f.claim}" opens with a bare pronoun`)
  }
})

test('a regulator warning becomes a REGULATORY finding carrying its source', () => {
  const investigation = buildInvestigation({
    review: { id: 'r', slug: 's', scam_score: 88, author_name: 'X' },
    brand: {
      id: 'b', name: 'Acme', scam_score: 88,
      regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB', url: 'https://fca.org.uk/w', published_at: '2026-02-01' }],
    },
  })
  const reg = derivedObservedFindings(investigation).find((f) => f.evidence_class === 'REGULATORY')
  assert.ok(reg)
  assert.equal(reg.source_url, 'https://fca.org.uk/w')
  assert.match(reg.claim, /FCA \(GB\) published a warning naming Acme on 2026-02-01/)
})

test('victim reports render as REPORTED and say so in the sentence', () => {
  const investigation = buildInvestigation({
    review: { id: 'r', slug: 's', scam_score: 40, author_name: 'X' },
    brand: { id: 'b', name: 'Acme', scam_score: 40, victim_reports: { count: 7 } },
  })
  const rep = derivedObservedFindings(investigation).find((f) => f.evidence_class === 'REPORTED')
  assert.ok(rep)
  assert.match(rep.claim, /These are reports, not independently verified losses\./)
})

test('a brand with no surveillance data produces no fabricated findings', () => {
  const investigation = buildInvestigation({
    review: { id: 'r', slug: 's', scam_score: 5, author_name: 'X' },
    brand: { id: 'b', name: 'Empty', scam_score: 5 },
  })
  assert.deepEqual(derivedObservedFindings(investigation), [])
})
