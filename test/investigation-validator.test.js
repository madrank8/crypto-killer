'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { validateInvestigation, SEVERITY, findDuplicateBlocks } = require('../lib/investigation-validator')

const NOW = new Date('2026-08-31T00:00:00Z')

function fixture(reviewPatch = {}, brandPatch = {}) {
  return {
    now: NOW,
    review: {
      id: 'r1',
      slug: 'acme',
      scam_score: 45,
      status: 'published',
      published_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
      author_name: 'M. Webb',
      author_persona_id: 'webb',
      sources: [{ url: 'https://example.org/a' }],
      full_article: '<p>Acme Trade advertising was observed across the European markets listed in the snapshot above.</p>',
      ...reviewPatch,
    },
    brand: {
      id: 'b1',
      name: 'Acme Trade',
      scam_score: 45,
      primary_domain: 'acme.example',
      first_seen_at: '2026-06-01T00:00:00Z',
      last_seen_at: '2026-08-20T00:00:00Z',
      lifespan_days: 80,
      total_creatives: 12,
      geo_list: ['GB', 'DE', 'FR'],
      celebrity_list: [],
      ...brandPatch,
    },
  }
}

const codes = (r) => r.findings.map((f) => f.code)
const has = (r, code) => codes(r).includes(code)
const sev = (r, code) => r.findings.find((f) => f.code === code)?.severity

test('a clean investigation passes with no findings', () => {
  const r = validateInvestigation(fixture())
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings, null, 2))
  assert.equal(r.ok, true)
  assert.equal(r.canPublish, true)
})

test('score drift blocks publishing', () => {
  const r = validateInvestigation(fixture({}, { scam_score: 30 }))
  assert.ok(has(r, 'SCORE_DRIFT'))
  assert.equal(sev(r, 'SCORE_DRIFT'), SEVERITY.CRITICAL)
  assert.equal(r.canPublish, false)
  assert.match(r.blockReason, /SCORE_DRIFT/)
})

test('an invalid score blocks publishing', () => {
  const r = validateInvestigation(fixture({ scam_score: 140 }, { scam_score: 140 }))
  assert.ok(has(r, 'SCORE_INVALID'))
  assert.equal(r.canPublish, false)
})

test('a missing score blocks publishing', () => {
  const r = validateInvestigation(fixture({ scam_score: null }, { scam_score: null }))
  assert.ok(has(r, 'SCORE_MISSING'))
  assert.equal(r.canPublish, false)
})

test('impossible date chronology blocks publishing', () => {
  const r = validateInvestigation(fixture({}, { first_seen_at: '2026-09-01', last_seen_at: '2026-08-20' }))
  assert.ok(has(r, 'DATE_CHRONOLOGY_IMPOSSIBLE'))
  assert.equal(r.canPublish, false)
})

test('published later than updated blocks publishing', () => {
  const r = validateInvestigation(fixture({ published_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-02T00:00:00Z' }))
  assert.ok(has(r, 'PUBLISHED_AFTER_UPDATED'))
  assert.equal(r.canPublish, false)
})

test('a definitive fraud claim on a low-evidence investigation blocks publishing', () => {
  const r = validateInvestigation(
    fixture({ scam_score: 15, verdict: 'Acme Trade is a confirmed crypto scam.' }, { scam_score: 15 }),
  )
  assert.ok(has(r, 'DEFINITIVE_CLAIM_UNSUPPORTED'))
  assert.equal(r.canPublish, false)
})

test('a hedged claim at a low band does not trip the language gate', () => {
  const r = validateInvestigation(
    fixture({ scam_score: 15, verdict: 'Acme Trade is a suspected scam pending verification.' }, { scam_score: 15 }),
  )
  assert.equal(has(r, 'DEFINITIVE_CLAIM_UNSUPPORTED'), false)
})

test('definitive language IS allowed once the evidentiary test is met', () => {
  const r = validateInvestigation(
    fixture(
      { scam_score: 88, verdict: 'Acme Trade is a confirmed crypto scam.' },
      { scam_score: 88, regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB', url: 'https://fca.org.uk/x' }] },
    ),
  )
  assert.equal(has(r, 'DEFINITIVE_CLAIM_UNSUPPORTED'), false)
  assert.equal(r.investigation.threat_classification, 'CONFIRMED')
})

test('an 80+ score without corroboration warns and is presented one band lower', () => {
  const r = validateInvestigation(fixture({ scam_score: 88 }, { scam_score: 88 }))
  assert.ok(has(r, 'CONFIRMED_EVIDENCE_SHORTFALL'))
  assert.equal(sev(r, 'CONFIRMED_EVIDENCE_SHORTFALL'), SEVERITY.WARNING)
  assert.equal(r.investigation.threat_classification, 'HIGH_RISK')
  assert.equal(r.canPublish, true, 'a shortfall constrains language; it does not block the page')
})

test('two different values for the same metric block publishing', () => {
  const r = validateInvestigation(
    fixture({ summary: 'Acme Trade reached 9 countries.', full_article: '<p>Acme Trade advertising spanned 3 countries.</p>' }),
  )
  assert.ok(has(r, 'METRIC_SELF_CONTRADICTION'))
  assert.equal(r.canPublish, false)
})

test('a metric literal that disagrees with canon blocks publishing', () => {
  const r = validateInvestigation({ ...fixture({ summary: 'Acme Trade reached 9 countries.' }) })
  assert.ok(has(r, 'METRIC_LITERAL_DRIFT'))
  assert.equal(r.canPublish, false)
})

test('a correct literal still warns, because it will drift', () => {
  const r = validateInvestigation(fixture({ summary: 'Acme Trade reached 3 countries.' }))
  assert.ok(has(r, 'METRIC_HARDCODED'))
  assert.equal(sev(r, 'METRIC_HARDCODED'), SEVERITY.WARNING)
  assert.equal(r.canPublish, true)
})

test('a strong external allegation with no sources blocks publishing', () => {
  const r = validateInvestigation(
    fixture({ sources: [], citations: [], full_article: '<p>The FCA published a warning against Acme Trade in 2026.</p>' }),
  )
  assert.ok(has(r, 'STRONG_CLAIM_UNSOURCED'))
  assert.equal(r.canPublish, false)
})

test('no sources at all, with no strong allegation, only warns', () => {
  const r = validateInvestigation(fixture({ sources: [], citations: [] }))
  assert.ok(has(r, 'NO_EVIDENCE_SOURCE'))
  assert.equal(sev(r, 'NO_EVIDENCE_SOURCE'), SEVERITY.WARNING)
  assert.equal(r.canPublish, true)
})

test('missing analyst, last-checked date and primary domain warn but do not block', () => {
  const r = validateInvestigation(fixture({ author_name: null, author_persona_id: null }, { last_seen_at: null, primary_domain: null }))
  for (const c of ['ANALYST_MISSING', 'LAST_CHECKED_MISSING', 'PRIMARY_DOMAIN_MISSING']) {
    assert.ok(has(r, c), c)
    assert.equal(sev(r, c), SEVERITY.WARNING)
  }
  assert.equal(r.canPublish, true)
})

test('a stale last-checked date warns', () => {
  const r = validateInvestigation(fixture({}, { last_seen_at: '2026-05-01T00:00:00Z' }))
  assert.ok(has(r, 'LAST_CHECKED_STALE'))
  assert.equal(sev(r, 'LAST_CHECKED_STALE'), SEVERITY.WARNING)
})

test('a stale cached lifespan warns and names both numbers', () => {
  const r = validateInvestigation(fixture({}, { lifespan_days: 250 }))
  const f = r.findings.find((x) => x.code === 'DAYS_ACTIVE_CACHE_DRIFT')
  assert.ok(f)
  assert.match(f.message, /250/)
  assert.equal(f.severity, SEVERITY.WARNING)
})

test('an unrecognised evidence class blocks publishing', () => {
  const r = validateInvestigation(
    fixture({ evidence_items: [{ claim: 'Something happened.', evidence_class: 'OBSERVEDD' }] }),
  )
  assert.ok(has(r, 'EVIDENCE_CLASS_UNKNOWN'))
  assert.equal(r.canPublish, false)
})

test('a REGULATORY finding without a source URL blocks publishing', () => {
  const r = validateInvestigation(
    fixture({ evidence_items: [{ claim: 'The BaFin warned about Acme Trade.', evidence_class: 'REGULATORY' }] }),
  )
  assert.ok(has(r, 'REGULATORY_ITEM_NO_SOURCE'))
  assert.equal(r.canPublish, false)
})

test('a paragraph opening with a bare pronoun warns', () => {
  const r = validateInvestigation(
    fixture({ full_article: '<p>It was first detected on 9 September 2025 during routine surveillance of advertising networks.</p>' }),
  )
  assert.ok(has(r, 'AMBIGUOUS_PARAGRAPH_OPENER'))
  assert.equal(sev(r, 'AMBIGUOUS_PARAGRAPH_OPENER'), SEVERITY.WARNING)
})

test('a self-contained paragraph opener does not warn', () => {
  const r = validateInvestigation(
    fixture({ full_article: '<p>Acme Trade was first detected on 9 September 2025 during routine surveillance of advertising networks.</p>' }),
  )
  assert.equal(has(r, 'AMBIGUOUS_PARAGRAPH_OPENER'), false)
})

test('duplicate passages across fields are detected', () => {
  const passage = 'Crypto Killer catalogued advertising creatives promoting this platform across multiple European advertising networks during the monitoring window.'
  const dupes = findDuplicateBlocks([
    { label: 'summary', text: passage },
    { label: 'verdict', text: passage },
  ])
  assert.equal(dupes.length, 1)
  assert.deepEqual(dupes[0].fields.sort(), ['summary', 'verdict'])
})

test('the validator never throws on a sparse row', () => {
  const r = validateInvestigation({ review: { id: 'x' }, now: NOW })
  assert.equal(typeof r.canPublish, 'boolean')
  assert.ok(r.findings.length > 0)
})

test('a safety directive is proportionate at ELEVATED_RISK and above', () => {
  for (const score of [45, 65]) {
    const r = validateInvestigation(fixture({ scam_score: score, verdict: 'Do not deposit funds with Acme Trade.' }, { scam_score: score }))
    assert.equal(has(r, 'DEFINITIVE_CLAIM_UNSUPPORTED'), false, `score ${score}`)
  }
})

test('a safety directive below ELEVATED_RISK blocks, because the page also says the evidence is insufficient', () => {
  for (const score of [10, 30]) {
    const r = validateInvestigation(fixture({ scam_score: score, verdict: 'Do not deposit funds with Acme Trade.' }, { scam_score: score }))
    assert.ok(has(r, 'DEFINITIVE_CLAIM_UNSUPPORTED'), `score ${score}`)
    assert.equal(r.findings.find((x) => x.code === 'DEFINITIVE_CLAIM_UNSUPPORTED').claim_kind, 'directive')
  }
})

test('a fraud assertion is blocked at every band below CONFIRMED-with-evidence', () => {
  for (const score of [10, 30, 45, 65, 88]) {
    const r = validateInvestigation(fixture({ scam_score: score, verdict: 'Acme Trade is a confirmed crypto scam.' }, { scam_score: score }))
    const hit = r.findings.find((x) => x.code === 'DEFINITIVE_CLAIM_UNSUPPORTED')
    assert.ok(hit, `score ${score}`)
    assert.equal(hit.claim_kind, 'assertion')
  }
})

test('REVIEW FIX: a metric split by an inline tag is still scanned', () => {
  const r = validateInvestigation(
    fixture({ full_article: '<p>Acme ads were observed across <strong>9</strong> countries in total.</p>' }),
  )
  assert.ok(has(r, 'METRIC_LITERAL_DRIFT'), 'drift hidden by <strong> markup')
})

test('REVIEW FIX: adjacent stat-card cells still never fuse into a phantom claim', () => {
  const r = validateInvestigation(
    fixture({ full_article: '<div><p>Ad Creatives</p><p>71</p></div><div><p>Countries</p><p>9</p></div>' }),
  )
  assert.equal(has(r, 'METRIC_LITERAL_DRIFT'), false)
  assert.equal(has(r, 'METRIC_SELF_CONTRADICTION'), false)
})
