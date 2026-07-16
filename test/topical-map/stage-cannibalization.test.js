const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeCurrentStage, STAGES, stageIndex } = require('../../lib/topical-map/stages')

// Fake supaFetch: no existing topics/content/reviews except one live keyword collision.
function fakeSupaFetch(url) {
  if (url.startsWith('/topics')) return Promise.resolve([{ slug: 'live-slug', title: 'Taken', target_keyword: 'taken kw', map_id: 'm' }])
  if (url.startsWith('/content')) return Promise.resolve([])
  if (url.startsWith('/reviews')) return Promise.resolve([])
  return Promise.resolve([])
}

const CLUSTERS = [
  { cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500, keywords: [{ keyword: 'alpha kw' }] },
  { cluster_key: 'c2', head_keyword: 'alpha kw', total_volume: 400, keywords: [{ keyword: 'alpha kw' }] }, // intra dup
  { cluster_key: 'c3', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw' }] },  // live collision
  { cluster_key: 'c4', head_keyword: 'zeta kw', total_volume: 0, keywords: [{ keyword: 'zeta kw' }] },      // zero demand
]

test('cannibalization stage sits between competitor_gap and structure', () => {
  assert.equal(stageIndex('cannibalization'), stageIndex('competitor_gap') + 1)
  assert.equal(stageIndex('structure'), stageIndex('cannibalization') + 1)
})

test('stage drops cannibalizing clusters and overwrites artifacts.clusters with survivors', async () => {
  const run = { current_stage: 'cannibalization', artifacts: { clusters: CLUSTERS } }
  const res = await executeCurrentStage(run, { supaFetch: fakeSupaFetch })
  assert.deepEqual(res.artifacts.clusters.map((c) => c.cluster_key), ['c1'])       // only clean survivor
  assert.equal(res.artifacts.pool_cannibalization.dropped_count, 3)
  assert.deepEqual(res.artifacts.pool_cannibalization.dropped_keys.sort(), ['c2', 'c3', 'c4'])
  assert.equal(res.artifacts.pool_cannibalization.guard_kept_all, false)
  assert.equal(res.current_stage, 'structure') // advances to structure
  assert.equal(res.status, 'running')          // no checkpoint
})

test('guard: if every cluster would be dropped, keep them all so structure has input', async () => {
  const allZero = [
    { cluster_key: 'z1', head_keyword: 'a', total_volume: 0, keywords: [{ keyword: 'a' }] },
    { cluster_key: 'z2', head_keyword: 'b', total_volume: 0, keywords: [{ keyword: 'b' }] },
  ]
  const run = { current_stage: 'cannibalization', artifacts: { clusters: allZero } }
  const res = await executeCurrentStage(run, { supaFetch: fakeSupaFetch })
  assert.equal(res.artifacts.clusters.length, 2)                         // kept all
  assert.equal(res.artifacts.pool_cannibalization.guard_kept_all, true)
})
