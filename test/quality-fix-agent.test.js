const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runQualityFixAgent } = require('../lib/quality-fix-agent')

function baseDeps(overrides = {}) {
  return {
    remediateDeterministic: () => ({ patch: { full_article: '<p>with disclosure</p>' }, applied: [{ key: 'missing_risk_or_ftc_disclosure', what: 'appended' }], unfixable: [] }),
    runSurgicalModel: async () => ({ patches: [], load_bearing_claims: [] }),
    applySurgicalPatches: () => ({ patch: {}, applied: [], rejected: [] }),
    researchSourcesForClaims: async () => ({ sources: [], rejected: [] }),
    persistPatch: async (patch) => ({ id: '1', full_article: patch.full_article || '', ai_audit: {} }),
    reaudit: async (row) => ({ row, hardFails: [] }),
    publish: async () => ({ ok: true, status: 200 }),
    send: () => {},
    ...overrides,
  }
}

test('auto-publishes when reaudit clears hard fails', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    autoPublish: true,
    deps: baseDeps(),
  })
  assert.equal(out.ready, true)
  assert.equal(out.published, true)
  assert.equal(out.ok, true)
})

test('does not publish when unfixable remains after reaudit', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1' },
    hardFails: [{ key: 'commodity_no_information_gain', reason: 'commodity' }],
    deps: baseDeps({
      remediateDeterministic: () => ({ patch: {}, applied: [], unfixable: [{ key: 'commodity_no_information_gain', reason: 'commodity', operator_action: 'add evidence' }] }),
      reaudit: async (row) => ({ row, hardFails: [{ key: 'commodity_no_information_gain', reason: 'commodity' }] }),
      publish: async () => { throw new Error('publish must not be called') },
    }),
  })
  assert.equal(out.published, false)
  assert.equal(out.ready, false)
  assert.ok(out.unfixable.length >= 1)
})

test('never calls publish with override', async () => {
  let publishArgs = null
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'x' }],
    deps: baseDeps({
      publish: async (row, opts) => {
        publishArgs = opts
        return { ok: true, status: 200 }
      },
    }),
  })
  assert.equal(out.published, true)
  assert.equal(publishArgs?.override, undefined)
})

test('deps throw returns ok false without publishing', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    deps: baseDeps({
      persistPatch: async () => {
        throw new Error('persist exploded')
      },
      publish: async () => {
        throw new Error('publish must not be called')
      },
    }),
  })
  assert.equal(out.ok, false)
  assert.equal(out.published, false)
  assert.equal(out.ready, false)
  assert.ok(out.reasons.some((r) => String(r).includes('persist exploded')))
})

test('autoPublish defaults to true', async () => {
  let publishedCalled = false
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>' },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    deps: baseDeps({
      publish: async () => {
        publishedCalled = true
        return { ok: true, status: 200 }
      },
    }),
  })
  assert.equal(publishedCalled, true)
  assert.equal(out.published, true)
})

test('score does not block publish when hard fails empty', async () => {
  const out = await runQualityFixAgent({
    kind: 'content',
    row: { id: '1', full_article: '<p>x</p>', ai_audit: { overall_score: 40 } },
    hardFails: [{ key: 'missing_risk_or_ftc_disclosure', reason: 'missing' }],
    deps: baseDeps({
      reaudit: async (row) => ({
        row: { ...row, ai_audit: { overall_score: 40 } },
        hardFails: [],
      }),
    }),
  })
  assert.equal(out.ready, true)
  assert.equal(out.published, true)
})
