const { test } = require('node:test')
const assert = require('node:assert/strict')
const { filterClustersByCannibalization, DROP_FLAGS } = require('../../lib/topical-map/cannibalization')

function ctx() {
  return { existingKeywords: new Map([['taken kw', 'live-slug']]), existingSlugs: new Set(), existingTitleTokens: [] }
}

test('DROP_FLAGS is exactly the three unambiguous flags', () => {
  assert.deepEqual([...DROP_FLAGS].sort(), ['intra_map_duplicate', 'keyword_collision', 'zero_demand'])
})

test('drops intra-dup / keyword-collision / zero-demand; keeps clean + unverified', () => {
  const clusters = [
    { cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500, keywords: [{ keyword: 'alpha kw' }] }, // clean -> keep
    { cluster_key: 'c2', head_keyword: 'alpha kw', total_volume: 400, keywords: [{ keyword: 'alpha kw' }] }, // intra_map_duplicate -> drop
    { cluster_key: 'c3', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw' }] },  // keyword_collision -> drop
    { cluster_key: 'c4', head_keyword: 'zeta kw', total_volume: 0, keywords: [{ keyword: 'zeta kw' }] },      // zero_demand -> drop
    { cluster_key: 'c5', head_keyword: 'eta kw', total_volume: 50, keywords: [{ keyword: 'eta kw', keyword_data_source: 'llm-estimated' }] }, // unverified -> KEEP
  ]
  const { survivors, dropped, report } = filterClustersByCannibalization(clusters, ctx())
  assert.deepEqual(survivors.map((c) => c.cluster_key), ['c1', 'c5'])
  assert.deepEqual(dropped.map((c) => c.cluster_key), ['c2', 'c3', 'c4'])
  assert.deepEqual(report.counts, { intra_map_duplicate: 1, keyword_collision: 1, zero_demand: 1, unverified_keyword: 1 })
})

test('empty input yields empty survivors/dropped', () => {
  const { survivors, dropped } = filterClustersByCannibalization([], ctx())
  assert.deepEqual(survivors, [])
  assert.deepEqual(dropped, [])
})

test('all-cannibalizing input drops all (the stage, not the filter, guards emptying)', () => {
  const clusters = [
    { cluster_key: 'z1', head_keyword: 'a', total_volume: 0, keywords: [{ keyword: 'a' }] },
    { cluster_key: 'z2', head_keyword: 'b', total_volume: 0, keywords: [{ keyword: 'b' }] },
  ]
  const { survivors, dropped } = filterClustersByCannibalization(clusters, { existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [] })
  assert.equal(survivors.length, 0)
  assert.equal(dropped.length, 2)
})
