const { test } = require('node:test'); const assert = require('node:assert/strict')
const {
  CONTENT_TYPES, FORCING_INPUT_SPECS, validateSullivanGate, sullivanStopMessage,
} = require('../../lib/content-brief/sullivan')

const VALID = {
  case_study: {
    concrete_metric: '73% of traffic from 12% of articles',
    what_we_did_differently: 'Pruned every commodity page first',
    timeframe: 'Q2 2026',
    proprietary_source: 'CryptoKiller platform data',
  },
  original_data_study: {
    dataset_source: 'internal_db',
    n_size: 217,
    methodology: 'Sampled every brand ingested since 2019, excluding duplicates.',
    novel_finding: 'Celebrity-impersonation ads cluster in 3 geos',
    collection_date: '2026-07-01',
  },
  firsthand_review: {
    direct_anecdotes: ['saw the withdrawal block', 'support went silent', 'domain rotated twice'],
    field_observation_count: '400 callouts since 2019',
    recurring_pattern: 'Withdrawal freeze after first profitable trade',
    credentials: 'Lead scam investigator, 6 years',
  },
  contrarian_opinion: {
    consensus_position: 'All sweepstakes casinos are equally risky',
    counter_position: 'Licensing tier predicts payout reliability more than reviews do',
    evidence_from_portfolio: ['case A paid out', 'case B did not'],
    where_consensus_fails: 'When the operator holds a tier-1 license',
  },
  infrastructure: {
    entity_id: 'Q806097',
    sub_entities: ['rug pull', 'pig butchering', 'fake exchange'],
    internal_link_targets: ['/reviews/a', '/reviews/b', '/guides/c'],
    semantic_role: 'glossary',
  },
}

test('the five SC-098 content types are exactly as specified', () => {
  assert.deepEqual([...CONTENT_TYPES].sort(), ['case_study', 'contrarian_opinion', 'firsthand_review', 'infrastructure', 'original_data_study'])
  for (const t of CONTENT_TYPES) assert.ok(Array.isArray(FORCING_INPUT_SPECS[t]) && FORCING_INPUT_SPECS[t].length > 0, `${t} has specs`)
})

test('every content type passes with complete forcing inputs', () => {
  for (const t of CONTENT_TYPES) {
    const res = validateSullivanGate({ content_type: t, forcing_inputs: VALID[t] })
    assert.equal(res.ok, true, `${t} should pass: ${JSON.stringify(res.missing)}`)
    assert.deepEqual(res.missing, [])
    assert.equal(sullivanStopMessage(res), null)
  }
})

test('no content_type -> blocked with the choose-one message (not inferred)', () => {
  const res = validateSullivanGate({})
  assert.equal(res.ok, false)
  assert.equal(res.content_type, null)
  assert.match(res.errors[0], /No content_type declared/)
  assert.match(res.errors[0], /commodity content/)
})

test('invalid content_type -> blocked, never coerced to a valid one', () => {
  const res = validateSullivanGate({ content_type: 'listicle', forcing_inputs: {} })
  assert.equal(res.ok, false)
  assert.equal(res.content_type, null)
  assert.match(res.errors[0], /Invalid content_type/)
})

test('missing forcing inputs are reported, never invented', () => {
  const res = validateSullivanGate({ content_type: 'case_study', forcing_inputs: { concrete_metric: '73%' } })
  assert.equal(res.ok, false)
  assert.deepEqual(res.missing.map((m) => m.field).sort(), ['proprietary_source', 'timeframe', 'what_we_did_differently'])
  for (const m of res.missing) assert.equal(m.reason, 'missing')
  // the gate reports; it must not hand back a filled value
  assert.equal(res.forcing_inputs, undefined)
})

test('n_size threshold: <100 rejected, >=100 accepted, non-integer rejected', () => {
  const withN = (n) => validateSullivanGate({ content_type: 'original_data_study', forcing_inputs: { ...VALID.original_data_study, n_size: n } })
  assert.equal(withN(99).ok, false)
  assert.match(withN(99).missing.find((m) => m.field === 'n_size').reason, /≥ 100/)
  assert.equal(withN(100).ok, true)
  assert.equal(withN(217).ok, true)
  assert.equal(withN(150.5).ok, false)
  assert.equal(withN('abc').ok, false)
})

test('list thresholds: anecdotes >=3, portfolio evidence >=2, sub_entities >=3', () => {
  const fr = validateSullivanGate({ content_type: 'firsthand_review', forcing_inputs: { ...VALID.firsthand_review, direct_anecdotes: ['one', 'two'] } })
  assert.match(fr.missing.find((m) => m.field === 'direct_anecdotes').reason, /at least 3 entries \(got 2\)/)

  const co = validateSullivanGate({ content_type: 'contrarian_opinion', forcing_inputs: { ...VALID.contrarian_opinion, evidence_from_portfolio: ['only one'] } })
  assert.match(co.missing.find((m) => m.field === 'evidence_from_portfolio').reason, /at least 2 entries/)

  const inf = validateSullivanGate({ content_type: 'infrastructure', forcing_inputs: { ...VALID.infrastructure, sub_entities: ['a', 'b'] } })
  assert.match(inf.missing.find((m) => m.field === 'sub_entities').reason, /at least 3 entries/)
})

test('blank list entries do not count toward the threshold', () => {
  const res = validateSullivanGate({ content_type: 'firsthand_review', forcing_inputs: { ...VALID.firsthand_review, direct_anecdotes: ['real', '', '   '] } })
  assert.equal(res.ok, false)
  assert.match(res.missing.find((m) => m.field === 'direct_anecdotes').reason, /got 1/)
})

test('enum fields reject out-of-vocabulary values', () => {
  const res = validateSullivanGate({ content_type: 'original_data_study', forcing_inputs: { ...VALID.original_data_study, dataset_source: 'vibes' } })
  assert.match(res.missing.find((m) => m.field === 'dataset_source').reason, /must be one of/)
})

test('infrastructure entity_id must be a real Q-ID shape (no fabricated placeholder)', () => {
  const bad = (v) => validateSullivanGate({ content_type: 'infrastructure', forcing_inputs: { ...VALID.infrastructure, entity_id: v } })
  assert.equal(bad('P902').ok, false)          // property id, not entity
  assert.equal(bad('Q12345').ok, true)
  assert.equal(bad('[UNRESOLVED]').ok, false)  // placeholder must not satisfy the gate
  assert.equal(bad('12345').ok, false)
})

test('collection_date must be YYYY-MM-DD', () => {
  const res = validateSullivanGate({ content_type: 'original_data_study', forcing_inputs: { ...VALID.original_data_study, collection_date: 'July 2026' } })
  assert.match(res.missing.find((m) => m.field === 'collection_date').reason, /YYYY-MM-DD/)
})

test('malformed forcing_inputs container is treated as empty, never throws', () => {
  for (const bad of [null, undefined, 'nope', 42, ['a']]) {
    const res = validateSullivanGate({ content_type: 'case_study', forcing_inputs: bad })
    assert.equal(res.ok, false)
    assert.equal(res.missing.length, FORCING_INPUT_SPECS.case_study.length)
  }
})

test('stop message names the type and every missing field', () => {
  const res = validateSullivanGate({ content_type: 'case_study', forcing_inputs: {} })
  const msg = sullivanStopMessage(res)
  assert.match(msg, /SC-098 Sullivan Test/)
  assert.match(msg, /content_type=case_study/)
  for (const spec of FORCING_INPUT_SPECS.case_study) assert.match(msg, new RegExp(spec.field))
})

test('specs are returned so the UI can render the exact required form', () => {
  const res = validateSullivanGate({ content_type: 'infrastructure', forcing_inputs: {} })
  assert.deepEqual(res.specs.map((s) => s.field), ['entity_id', 'sub_entities', 'internal_link_targets', 'semantic_role'])
  for (const s of res.specs) assert.ok(s.label && s.kind)
})
