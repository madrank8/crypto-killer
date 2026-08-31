'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runMapWriterTick } = require('../../lib/topical-map/map-writer-run')

function mockDb(handlers) {
  const calls = []
  const fn = async (path, opts = {}) => {
    calls.push({ path, opts })
    for (const h of handlers) {
      if (h.match(path, opts)) return h.return
    }
    throw new Error(`unexpected db call ${opts.method || 'GET'} ${path}`)
  }
  fn.calls = calls
  return fn
}

const DUE_TOPIC = {
  id: 't-due',
  title: 'Pig Butchering: How It Works',
  slug: 'pig-butchering',
  topic_type: 'supporting',
  target_keyword: 'pig butchering scam',
  content_status: 'planned',
  scheduled_for: '2026-08-20',
  priority_score: 80,
  content_id: null,
  review_id: null,
}

test('runMapWriterTick skips when AGENT_AUTODRAFT=0', async () => {
  const result = await runMapWriterTick({
    env: { AGENT_AUTODRAFT: '0' },
    supabaseRequest: async () => { throw new Error('db should not run') },
    origin: 'https://example.com',
    authHeader: 'Bearer x',
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'AGENT_AUTODRAFT=0')
})

test('runMapWriterTick never POSTs to a publish route', async () => {
  const fetchCalls = []
  const db = mockDb([
    { match: (p) => p.includes('/work_plan_items?action_type'), return: [] },
    { match: (p) => p.includes('/topical_maps?status'), return: [{ id: 'map-1', stats: { publication: { cadence: 'growing', perWeek: 5 } } }] },
    { match: (p) => p.includes('/topics?map_id='), return: [DUE_TOPIC] },
    { match: (p) => p.includes('/content_briefs?map_id='), return: [{ topic_id: 't-due', sullivan_ok: true }] },
    { match: (p) => p.includes('/work_plan_items?fingerprint='), return: [] },
    { match: (p) => p.includes('/work_plan_items?on_conflict'), return: null },
    { match: (p) => p.includes('/work_plan_items?fingerprint=eq.') && p.includes('PATCH') || false, return: null },
    { match: (p) => p.includes('/agent_actions'), return: null },
  ])

  const fetchImpl = async (url, init = {}) => {
    fetchCalls.push({ url, method: init.method, body: init.body })
    return { ok: true, json: async () => ({ id: 'c-1' }) }
  }

  const result = await runMapWriterTick({
    env: {},
    supabaseRequest: db,
    fetchImpl,
    origin: 'https://app.example',
    authHeader: 'Bearer secret',
    today: '2026-08-20',
    consumeSse: async () => { throw new Error('sse should not run on create') },
  })

  assert.equal(result.action, 'created')
  assert.equal(fetchCalls.some((c) => /publish/i.test(c.url)), false)
  assert.equal(fetchCalls[0].url, 'https://app.example/api/admin/content/create')
})

test('runMapWriterTick fill body sets auto_publish false', async () => {
  let fillBody = null
  const db = mockDb([
    { match: (p) => p.includes('/work_plan_items?action_type'), return: [{
      fingerprint: 'write_content:t-due',
      status: 'running',
      content_id: 'c-1',
      action_type: 'write_content',
    }] },
    { match: (p) => p.includes('/topics?id=eq.t-due'), return: [{ ...DUE_TOPIC, content_id: 'c-1', content_status: 'draft' }] },
    { match: (p) => p.includes('/content?id=eq.c-1') && !(p.includes('PATCH')), return: [{
      id: 'c-1', outline_sections: [{ heading: 'H2' }], full_article: '', status: 'draft',
    }] },
    { match: (p) => p.includes('/content?id=eq.c-1'), return: null },
    { match: (p) => p.includes('/topics?id=eq.t-due') && true, return: null },
    { match: (p) => p.includes('/work_plan_items'), return: null },
    { match: (p) => p.includes('/agent_actions'), return: null },
  ])

  const result = await runMapWriterTick({
    env: {},
    supabaseRequest: db,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    origin: 'https://app.example',
    authHeader: 'Bearer secret',
    today: '2026-08-20',
    consumeSse: async (url, init) => {
      if (url.includes('/fill')) fillBody = JSON.parse(init.body)
      return { done: true, error: null }
    },
  })

  assert.equal(result.action, 'filled')
  assert.equal(result.published, false)
  assert.deepEqual(fillBody, { content_id: 'c-1', auto_publish: false })
})

test('runMapWriterTick blocks due topics that fail Sullivan', async () => {
  const db = mockDb([
    { match: (p) => p.includes('/work_plan_items?action_type'), return: [] },
    { match: (p) => p.includes('/topical_maps?status'), return: [{ id: 'map-1', stats: {} }] },
    { match: (p) => p.includes('/topics?map_id='), return: [DUE_TOPIC] },
    { match: (p) => p.includes('/content_briefs?map_id='), return: [{ topic_id: 't-due', sullivan_ok: false }] },
    { match: (p) => p.includes('/work_plan_items?fingerprint='), return: [] },
    { match: (p) => p.includes('/work_plan_items?on_conflict'), return: null },
  ])
  const result = await runMapWriterTick({
    env: {},
    supabaseRequest: db,
    fetchImpl: async () => { throw new Error('no fetch') },
    origin: 'https://app.example',
    authHeader: 'Bearer secret',
    today: '2026-08-20',
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'nothing_due')
  assert.ok(db.calls.some((c) => c.path.includes('/work_plan_items?on_conflict')))
  const inserted = JSON.parse(db.calls.find((c) => c.path.includes('on_conflict')).opts.body)
  assert.equal(inserted[0].status, 'blocked')
  assert.equal(inserted[0].last_error, 'needs_sullivan')
})
