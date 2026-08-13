'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

test('module exports content adapter entry points', async () => {
  const mod = require('../lib/quality-fix-content')
  assert.equal(typeof mod.loadContent, 'function')
  assert.equal(typeof mod.buildContentAgentDeps, 'function')
  assert.equal(typeof mod.buildContentAgentContext, 'function')
  assert.equal(typeof mod.runContentQualityFix, 'function')
})

test('publish dep POSTs { action: publish } only — never override', async () => {
  const { buildContentAgentDeps } = require('../lib/quality-fix-content')
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }
  }

  const deps = buildContentAgentDeps({
    id: 'e346d80e-b41a-4eca-bf7e-57afaf2e824f',
    authorization: 'Bearer test-token',
    origin: 'http://localhost:3000',
    send: () => {},
    fetchImpl,
  })

  const pub = await deps.publish({ id: 'e346d80e-b41a-4eca-bf7e-57afaf2e824f' })
  assert.equal(pub.ok, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/api\/admin\/content\/e346d80e-b41a-4eca-bf7e-57afaf2e824f\/publish$/)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token')
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body, { action: 'publish' })
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'override'), false)
})

test('runContentQualityFix stamps ai_audit.quality_fix after agent', async () => {
  const { runContentQualityFix } = require('../lib/quality-fix-content')
  const patches = []

  const result = await runContentQualityFix('row-1', {
    autoPublish: false,
    send: () => {},
    row: {
      id: 'row-1',
      title: 'Test',
      full_article: '<p>body</p>',
      ai_audit: { overall_score: 70, hard_fail_checks: {} },
    },
    hardFails: [],
    runAgent: async (ctx) => {
      assert.equal(ctx.kind, 'content')
      assert.equal(ctx.autoPublish, false)
      assert.equal(typeof ctx.deps.publish, 'function')
      assert.equal(typeof ctx.deps.remediateDeterministic, 'function')
      return {
        ok: true,
        ready: true,
        published: false,
        applied: [{ key: 'missing_risk_or_ftc_disclosure', what: 'appended' }],
        unfixable: [],
        reasons: [],
        audit_summary: { hard_fails: [], overall_score: 70 },
        quality_fix: {
          at: '2026-08-13T00:00:00.000Z',
          model: 'gpt-5.4',
          applied: [{ key: 'missing_risk_or_ftc_disclosure', what: 'appended' }],
          unfixable: [],
          published: false,
          cycle: 1,
        },
        row: ctx.row,
      }
    },
    stampPersist: async (ai_audit) => {
      patches.push(ai_audit)
      return ai_audit
    },
  })

  assert.equal(result.ok, true)
  assert.equal(patches.length, 1)
  assert.equal(patches[0].quality_fix.model, 'gpt-5.4')
  assert.equal(patches[0].quality_fix.cycle, 1)
  assert.equal(result.row.ai_audit.quality_fix.published, false)
})
