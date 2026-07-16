const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  SHARED_URL_THRESHOLD, clusterBySerpOverlap, scoreAioRisk, summarizeClusters,
} = require('../../lib/topical-map/clustering')

test('SHARED_URL_THRESHOLD is 3', () => {
  assert.equal(SHARED_URL_THRESHOLD, 3)
})

test('clusterBySerpOverlap: keywords sharing >= 3 URLs merge; others stay separate', () => {
  const serp = new Map([
    ['a', { urls: ['u1', 'u2', 'u3', 'u9'] }],
    ['b', { urls: ['u1', 'u2', 'u3', 'u8'] }], // shares u1,u2,u3 with a -> merge
    ['c', { urls: ['z1', 'z2'] }],             // isolated
  ])
  assert.deepEqual([...clusterBySerpOverlap(serp).entries()], [['a', ['a', 'b']], ['c', ['c']]])
})

test('clusterBySerpOverlap: exactly 2 shared URLs does NOT merge', () => {
  const serp = new Map([
    ['a', { urls: ['u1', 'u2', 'x'] }],
    ['b', { urls: ['u1', 'u2', 'y'] }],
  ])
  assert.deepEqual([...clusterBySerpOverlap(serp).entries()], [['a', ['a']], ['b', ['b']]])
})

test('scoreAioRisk: AI overview + informational is critical', () => {
  assert.equal(scoreAioRisk({ features: ['ai_overview'] }, 'informational'), 'critical')
})

test('scoreAioRisk: AI overview + non-informational is high', () => {
  assert.equal(scoreAioRisk({ features: ['ai_overview'] }, 'transactional'), 'high')
})

test('scoreAioRisk: featured snippet + informational is high', () => {
  assert.equal(scoreAioRisk({ features: ['featured_snippet'] }, 'informational'), 'high')
})

test('scoreAioRisk: informational (null intent counts as informational) is medium', () => {
  assert.equal(scoreAioRisk({ features: [] }, 'informational'), 'medium')
  assert.equal(scoreAioRisk({ features: [] }, null), 'medium')
})

test('scoreAioRisk: transactional with no features, or null serp, is low', () => {
  assert.equal(scoreAioRisk({ features: [] }, 'transactional'), 'low')
  assert.equal(scoreAioRisk(null, 'transactional'), 'low')
})

test('summarizeClusters: head is highest-volume member; volumes summed; head intent drives aio_risk', () => {
  const clusters = new Map([['a', ['a', 'b']]])
  const pool = new Map([
    ['a', { keyword: 'a', search_volume: 100, search_intent: 'informational' }],
    ['b', { keyword: 'b', search_volume: 300, search_intent: 'transactional' }],
  ])
  const serpBy = new Map([['a', { features: ['ai_overview'], paa: ['q1'], domains: ['d1', 'd2'] }]])
  const out = summarizeClusters(clusters, pool, serpBy)
  assert.equal(out.length, 1)
  assert.equal(out[0].head_keyword, 'b')          // highest volume
  assert.equal(out[0].total_volume, 400)
  assert.equal(out[0].dominant_intent, 'transactional')
  assert.equal(out[0].aio_risk, 'high')           // ai_overview + head intent (transactional)
  assert.deepEqual(out[0].top_domains, ['d1', 'd2'])
})
