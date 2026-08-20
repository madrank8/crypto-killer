'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runMapSullivanTick } = require('../../lib/topical-map/sullivan-agent-run')
const { processTopic } = require('../../lib/topical-map/readiness/run-map')

const TODAY = '2026-08-20'

function brands(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    last_seen_at: '2026-08-01T00:00:00Z',
    scam_score: i < 30 ? 90 : 40,
  }))
}

function mockDb(state) {
  const calls = []
  const fn = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    calls.push({ path, method, body: opts.body })
    if (path.includes('/topical_maps?status')) return state.maps || [{ id: 'map-1', stats: {} }]
    if (path.includes('/topics?map_id=')) return state.topics || []
    if (path.includes('/content_briefs?map_id=')) return state.briefs || []
    if (path.startsWith('/content_briefs?topic_id=')) {
      if (method === 'PATCH') {
        state.briefWrites.push({ method, path, body: JSON.parse(opts.body) })
        return null
      }
      const topicId = decodeURIComponent(path.match(/topic_id=eq\.([^&]+)/)[1])
      const row = (state.topicBriefs || state.briefs || []).find((b) => b.topic_id === topicId)
      return row ? [row] : []
    }
    if (path.startsWith('/content_briefs') && method === 'POST') {
      state.briefWrites.push({ method, path, body: JSON.parse(opts.body) })
      return null
    }
    if (path.includes('/work_plan_items?fingerprint=') && method === 'PATCH') {
      state.workPlanPatches.push(JSON.parse(opts.body))
      return null
    }
    if (path.includes('/work_plan_items?fingerprint=')) return state.workPlan || []
    if (path.includes('/work_plan_items?on_conflict')) {
      state.workPlanInserts.push(JSON.parse(opts.body))
      return null
    }
    if (path.includes('/agent_actions')) {
      state.audits.push(JSON.parse(opts.body))
      return null
    }
    if (path.startsWith('/scam_brands')) return state.brands || []
    if (path.startsWith('/content?')) return state.content || []
    if (path.startsWith('/reviews?')) return state.reviews || []
    if (path.includes('/topics?parent_id=')) return state.children || []
    return []
  }
  fn.calls = calls
  return fn
}

function researchTopic(overrides = {}) {
  return {
    id: 't-research',
    title: 'Ad Spend Report',
    slug: 'ad-spend',
    url_path: '/research/ad-spend/',
    topic_type: 'supporting',
    content_status: 'planned',
    scheduled_for: TODAY,
    priority_score: 80,
    content_id: null,
    review_id: null,
    target_keyword: 'crypto ad spend',
    ...overrides,
  }
}

function alertTopic(overrides = {}) {
  return {
    id: 't-alert',
    title: 'Circle K Bitcoin ATM Scam',
    slug: 'circle-k',
    url_path: '/alerts/circle-k/',
    topic_type: 'supporting',
    content_status: 'planned',
    scheduled_for: TODAY,
    priority_score: 70,
    content_id: null,
    review_id: null,
    target_keyword: 'circle k bitcoin',
    ...overrides,
  }
}

test('runMapSullivanTick skips when AGENT_SULLIVAN=0', async () => {
  const result = await runMapSullivanTick({
    env: { AGENT_SULLIVAN: '0' },
    supabaseRequest: async () => {
      throw new Error('db should not run')
    },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'AGENT_SULLIVAN=0')
})

test('runMapSullivanTick skips when AGENT_RUNNER=0', async () => {
  const result = await runMapSullivanTick({
    env: { AGENT_RUNNER: '0' },
    supabaseRequest: async () => {
      throw new Error('db should not run')
    },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'AGENT_RUNNER=0')
})

test('pass sets sullivan_ok and never calls outline/fill/publish', async () => {
  const state = {
    topics: [researchTopic()],
    briefs: [],
    brands: brands(120),
    briefWrites: [],
    workPlanInserts: [],
    workPlanPatches: [],
    audits: [],
  }
  const fetchCalls = []
  const db = mockDb(state)
  const result = await runMapSullivanTick({
    env: {},
    supabaseRequest: db,
    today: TODAY,
    firecrawlApiKey: '',
    fetchImpl: async (url) => {
      fetchCalls.push(url)
      throw new Error(`unexpected fetch ${url}`)
    },
    callModel: async () => {
      throw new Error('LLM should not run for /research/')
    },
  })

  assert.equal(result.action, 'sullivan_ok')
  assert.equal(result.content_type, 'original_data_study')
  assert.equal(result.fingerprint, 'sullivan_evidence:t-research')
  assert.equal(fetchCalls.length, 0)
  assert.equal(
    db.calls.some((c) => /outline|fill|publish/i.test(c.path)),
    false
  )
  const write = state.briefWrites.find((w) => w.body.topic_id === 't-research' || w.method === 'POST')
  assert.ok(write)
  assert.equal(write.body.sullivan_ok, true)
  assert.equal(write.body.content_type, 'original_data_study')
  assert.equal(write.body.brief, undefined)
  const inserted = state.workPlanInserts[0][0]
  assert.equal(inserted.action_type, 'sullivan_evidence')
  assert.equal(inserted.status, 'done')
})

test('fail enqueues blocked work-plan item and does not call outline/fill/publish', async () => {
  const state = {
    topics: [alertTopic()],
    briefs: [],
    brands: [],
    briefWrites: [],
    workPlanInserts: [],
    workPlanPatches: [],
    audits: [],
  }
  const fetchCalls = []
  const db = mockDb(state)
  const result = await runMapSullivanTick({
    env: {},
    supabaseRequest: db,
    today: TODAY,
    firecrawlApiKey: '',
    fetchImpl: async (url) => {
      fetchCalls.push(url)
      return { ok: false }
    },
    callModel: async () => {
      throw new Error('LLM should not run for /alerts/')
    },
  })

  assert.equal(result.action, 'needs_evidence')
  assert.equal(result.content_type, 'firsthand_review')
  assert.ok(result.missing.includes('direct_anecdotes'))
  assert.equal(fetchCalls.some((u) => /outline|fill|publish/i.test(String(u))), false)
  const inserted = state.workPlanInserts[0][0]
  assert.equal(inserted.action_type, 'sullivan_evidence')
  assert.equal(inserted.status, 'blocked')
  assert.match(inserted.last_error, /direct_anecdotes/)
  const write = state.briefWrites[0]
  assert.equal(write.body.sullivan_ok, false)
})

test('human-saved content_type is not overwritten by classify', async () => {
  const state = {
    topics: [alertTopic({ url_path: '/learn/recovery-playbook/', title: 'Our Recovery Playbook' })],
    briefs: [{ topic_id: 't-alert', content_type: 'case_study', sullivan_ok: false }],
    topicBriefs: [{ topic_id: 't-alert', content_type: 'case_study', forcing_inputs: { timeframe: '2024' }, sullivan_ok: false }],
    briefWrites: [],
    workPlanInserts: [],
    workPlanPatches: [],
    audits: [],
  }
  let llmCalls = 0
  const db = mockDb(state)
  const result = await runMapSullivanTick({
    env: {},
    supabaseRequest: db,
    today: TODAY,
    firecrawlApiKey: '',
    callModel: async () => {
      llmCalls += 1
      return { text: '{"content_type":"firsthand_review"}' }
    },
    extractJSON: (text) => JSON.parse(text),
  })

  assert.equal(llmCalls, 0)
  assert.equal(result.content_type, 'case_study')
  assert.equal(result.action, 'needs_evidence')
  assert.equal(state.briefWrites[0].body.content_type, 'case_study')
  assert.equal(state.briefWrites[0].body.forcing_inputs.timeframe, '2024')
})

test('processTopic classifyType never replaces a human brief type', async () => {
  const writes = []
  const supaFetch = async (path, opts = {}) => {
    if (path.startsWith('/content_briefs') && (opts.method === 'PATCH' || opts.method === 'POST')) {
      writes.push(JSON.parse(opts.body))
      return null
    }
    if (path.startsWith('/content_briefs?topic_id=')) {
      return [{ id: 'cb-1', content_type: 'case_study', forcing_inputs: {}, sullivan_ok: false }]
    }
    return []
  }
  const out = await processTopic({
    topic: {
      id: 't-h',
      title: 'Circle K Bitcoin ATM Scam',
      url_path: '/alerts/circle-k/',
      content_status: 'planned',
    },
    mapId: 'map-1',
    supaFetch,
    classifyType: 'firsthand_review',
  })
  assert.equal(out.content_type, 'case_study')
  assert.equal(writes[0].content_type, 'case_study')
})
