const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeCurrentStage, stageIndex } = require('../../lib/topical-map/stages')

function fakeSupaFetch(url) {
  if (url.startsWith('/topics')) return Promise.resolve([{ slug: 'x', title: 'Taken', target_keyword: 'taken kw', map_id: 'm' }])
  return Promise.resolve([])
}

const CLUSTERS = [
  { cluster_key: 'A', head_keyword: 'alpha collide', total_volume: 600, keywords: [{ keyword: 'alpha collide', search_volume: 500 }, { keyword: 'alpha longtail', search_volume: 100 }] }, // head collides -> prune + re-head, KEEP
  { cluster_key: 'B', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw', search_volume: 200 }] }, // emptied -> drop
  { cluster_key: 'C', head_keyword: 'clean kw', total_volume: 300, keywords: [{ keyword: 'clean kw', search_volume: 300 }] }, // clean
  { cluster_key: 'D', head_keyword: 'zero kw', total_volume: 0, keywords: [{ keyword: 'zero kw', search_volume: 0 }] }, // zero_demand -> drop
]

test('cannibalization stage sits between competitor_gap and structure', () => {
  assert.equal(stageIndex('cannibalization'), stageIndex('competitor_gap') + 1)
  assert.equal(stageIndex('structure'), stageIndex('cannibalization') + 1)
})

test('stage prunes head collisions (keeps re-headed cluster) and drops emptied/zero clusters', async () => {
  // NOTE: existingKeywords also needs 'alpha collide' to be a live collision.
  const supa = (url) => {
    if (url.startsWith('/topics')) return Promise.resolve([
      { slug: 'x', title: 'T', target_keyword: 'taken kw', map_id: 'm' },
      { slug: 'y', title: 'A', target_keyword: 'alpha collide', map_id: 'm' },
    ])
    return Promise.resolve([])
  }
  const run = { current_stage: 'cannibalization', artifacts: { clusters: CLUSTERS } }
  const res = await executeCurrentStage(run, { supaFetch: supa })
  assert.deepEqual(res.artifacts.clusters.map((c) => c.cluster_key), ['A', 'C']) // A kept (re-headed), C clean
  assert.equal(res.artifacts.clusters.find((c) => c.cluster_key === 'A').head_keyword, 'alpha longtail')
  const pc = res.artifacts.pool_cannibalization
  assert.equal(pc.kept, 2)
  assert.deepEqual(pc.dropped_detail.map((d) => `${d.cluster_key}:${d.reason}`).sort(), ['B:emptied_by_collision', 'D:zero_demand'])
  assert.deepEqual(pc.pruned, [{ cluster_key: 'A', removed_keywords: ['alpha collide'] }])
  assert.equal(pc.guard_kept_all, false)
  assert.equal(res.current_stage, 'structure')
  assert.equal(res.status, 'running')
})

test('guard: if every cluster would be dropped, keep them all', async () => {
  const allZero = [
    { cluster_key: 'z1', head_keyword: 'a', total_volume: 0, keywords: [{ keyword: 'a', search_volume: 0 }] },
    { cluster_key: 'z2', head_keyword: 'b', total_volume: 0, keywords: [{ keyword: 'b', search_volume: 0 }] },
  ]
  const run = { current_stage: 'cannibalization', artifacts: { clusters: allZero } }
  const res = await executeCurrentStage(run, { supaFetch: fakeSupaFetch })
  assert.equal(res.artifacts.clusters.length, 2)
  assert.equal(res.artifacts.pool_cannibalization.guard_kept_all, true)
})
