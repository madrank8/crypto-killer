'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

test('module exports review adapter entry points', async () => {
  const mod = require('../lib/quality-fix-review')
  assert.equal(typeof mod.loadReview, 'function')
  assert.equal(typeof mod.buildReviewAgentDeps, 'function')
  assert.equal(typeof mod.buildReviewAgentContext, 'function')
  assert.equal(typeof mod.runReviewQualityFix, 'function')
  assert.equal(typeof mod.resolveReviewHardFails, 'function')
  assert.equal(typeof mod.remediateReviewDeterministic, 'function')
})

test('publish dep POSTs { action: publish } only — never override', async () => {
  const { buildReviewAgentDeps } = require('../lib/quality-fix-review')
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }
  }

  const deps = buildReviewAgentDeps({
    id: 'cce71b41-eac0-4b56-becc-2107621f91eb',
    authorization: 'Bearer test-token',
    origin: 'http://localhost:3000',
    send: () => {},
    fetchImpl,
  })

  const pub = await deps.publish()
  assert.equal(pub.ok, true)
  assert.equal(calls.length, 1)
  assert.match(
    calls[0].url,
    /\/api\/admin\/reviews\/cce71b41-eac0-4b56-becc-2107621f91eb\/publish$/,
  )
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token')
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body, { action: 'publish' })
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'override'), false)
})

test('resolveReviewHardFails prefers evaluateHardFails when hard_fail_checks present', async () => {
  const { resolveReviewHardFails } = require('../lib/quality-fix-review')
  const fails = resolveReviewHardFails({
    item_reviewed: { type: 'FinancialProduct', name: 'X' },
    ai_audit: {
      hard_fail_checks: {
        fabricated_source_or_stat: true,
        any_hard_fail: true,
        hard_fail_reason: 'made-up 73%',
      },
    },
  })
  assert.ok(fails.some((f) => f.key === 'fabricated_source_or_stat'))
})

test('resolveReviewHardFails synthesizes from audit_hard_fail_reason keys', async () => {
  const { resolveReviewHardFails } = require('../lib/quality-fix-review')
  const fails = resolveReviewHardFails({
    audit_hard_fail: true,
    audit_hard_fail_reason:
      "fabricated_source_or_stat is TRUE: the hard-coded claim 'SEC EDGAR' is not traceable",
  })
  assert.equal(fails.length, 1)
  assert.equal(fails[0].key, 'fabricated_source_or_stat')
  assert.match(fails[0].reason, /SEC EDGAR/)
})

test('remediateReviewDeterministic appends disclaimer for missing disclosure', async () => {
  const { remediateReviewDeterministic } = require('../lib/quality-fix-review')
  const { patch, applied, unfixable } = remediateReviewDeterministic(
    {
      full_article: '<p>Body about a scam platform.</p>',
      disclaimer: null,
    },
    [{ key: 'missing_risk_or_ftc_disclosure', reason: 'no disclosure' }],
  )
  assert.equal(unfixable.length, 0)
  assert.ok(applied.some((a) => a.key === 'missing_risk_or_ftc_disclosure'))
  assert.equal(typeof patch.disclaimer, 'string')
  assert.match(patch.disclaimer, /not financial/i)
  assert.match(patch.full_article, /risk-disclosure/i)
})

test('runReviewQualityFix stamps trust_indicators.quality_fix after agent', async () => {
  const { runReviewQualityFix } = require('../lib/quality-fix-review')
  const stamps = []

  const result = await runReviewQualityFix('row-1', {
    autoPublish: false,
    send: () => {},
    row: {
      id: 'row-1',
      title: 'Is Quantum a Scam?',
      full_article: '<p>body</p>',
      audit_hard_fail: true,
      audit_hard_fail_reason: 'fabricated_source_or_stat is TRUE: fake stat',
      trust_indicators: { audit_score: 70 },
    },
    hardFails: [{ key: 'fabricated_source_or_stat', reason: 'fake stat' }],
    runAgent: async (ctx) => {
      assert.equal(ctx.kind, 'review')
      assert.equal(ctx.autoPublish, false)
      assert.equal(typeof ctx.deps.publish, 'function')
      assert.equal(typeof ctx.deps.remediateDeterministic, 'function')
      return {
        ok: true,
        ready: false,
        published: false,
        applied: [],
        unfixable: [],
        reasons: ['fake stat'],
        audit_summary: { hard_fails: ctx.hardFails, overall_score: 70 },
        quality_fix: {
          at: '2026-08-13T00:00:00.000Z',
          model: 'gpt-5.4',
          applied: [],
          unfixable: [],
          published: false,
          cycle: 1,
        },
        row: ctx.row,
      }
    },
    stampPersist: async (quality_fix, trust_indicators) => {
      stamps.push({ quality_fix, trust_indicators })
      return trust_indicators
    },
  })

  assert.equal(result.ok, true)
  assert.equal(stamps.length, 1)
  assert.equal(stamps[0].quality_fix.model, 'gpt-5.4')
  assert.equal(stamps[0].quality_fix.cycle, 1)
  assert.equal(result.row.trust_indicators.quality_fix.published, false)
  assert.equal(result.row.ai_audit.quality_fix.cycle, 1)
})
