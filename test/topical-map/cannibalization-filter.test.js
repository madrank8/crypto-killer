const { test } = require('node:test')
const assert = require('node:assert/strict')
const { filterClustersByCannibalization, CLUSTER_DROP_FLAGS } = require('../../lib/topical-map/cannibalization')

function ctx() {
  return { existingKeywords: new Map([['binance scam', 'x'], ['taken kw', 'y']]), existingSlugs: new Set(), existingTitleTokens: [] }
}

test('CLUSTER_DROP_FLAGS no longer includes keyword_collision', () => {
  assert.deepEqual([...CLUSTER_DROP_FLAGS].sort(), ['intra_map_duplicate', 'zero_demand'])
})

test('per-keyword: head collision prunes the keyword and re-heads instead of dropping the cluster', () => {
  const clusters = [
    { cluster_key: 'A', head_keyword: 'binance scam', total_volume: 600, keywords: [{ keyword: 'binance scam', search_volume: 500 }, { keyword: 'binance withdrawal scam', search_volume: 100 }] },
  ]
  const { survivors, pruned } = filterClustersByCannibalization(clusters, ctx())
  assert.equal(survivors.length, 1)
  assert.equal(survivors[0].head_keyword, 'binance withdrawal scam') // re-headed to top surviving
  assert.equal(survivors[0].total_volume, 100)                       // recomputed
  assert.deepEqual(survivors[0].keywords.map((k) => k.keyword), ['binance withdrawal scam'])
  assert.deepEqual(pruned, [{ cluster_key: 'A', removed_keywords: ['binance scam'] }])
})

test('cluster emptied by collision is dropped with reason', () => {
  const clusters = [{ cluster_key: 'B', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw', search_volume: 200 }] }]
  const { survivors, dropped } = filterClustersByCannibalization(clusters, ctx())
  assert.equal(survivors.length, 0)
  assert.deepEqual(dropped, [{ cluster_key: 'B', reason: 'emptied_by_collision', removed_keywords: ['taken kw'] }])
})

test('intra_map_duplicate and zero_demand still drop whole clusters (post-prune)', () => {
  const clusters = [
    { cluster_key: 'C', head_keyword: 'clean kw', total_volume: 300, keywords: [{ keyword: 'clean kw', search_volume: 300 }] },
    { cluster_key: 'D', head_keyword: 'zero kw', total_volume: 0, keywords: [{ keyword: 'zero kw', search_volume: 0 }] },
    { cluster_key: 'E', head_keyword: 'clean kw', total_volume: 250, keywords: [{ keyword: 'clean kw', search_volume: 250 }] },
  ]
  const { survivors, dropped } = filterClustersByCannibalization(clusters, ctx())
  assert.deepEqual(survivors.map((c) => c.cluster_key), ['C'])
  assert.deepEqual(dropped.map((d) => `${d.cluster_key}:${d.reason}`).sort(), ['D:zero_demand', 'E:intra_map_duplicate'])
})

test('empty input', () => {
  const { survivors, dropped, pruned } = filterClustersByCannibalization([], ctx())
  assert.deepEqual(survivors, [])
  assert.deepEqual(dropped, [])
  assert.deepEqual(pruned, [])
})
