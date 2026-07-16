const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  clusterToCannibalizationNode, buildPoolCannibalizationReport,
} = require('../../lib/topical-map/cannibalization')

test('clusterToCannibalizationNode maps head_keyword + total_volume; no _slug/content_type', () => {
  const node = clusterToCannibalizationNode({
    cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500,
    keywords: [{ keyword: 'alpha kw' }],
  })
  assert.equal(node.title, 'alpha kw')
  assert.equal(node.target_keyword, 'alpha kw')
  assert.equal(node._metrics.search_volume, 500)
  assert.equal(node._metrics.keyword_data_source, undefined) // not all estimated
  assert.equal(node._cluster_key, 'c1')
  assert.equal('_slug' in node, false)       // pre-structure: no slug
  assert.equal('content_type' in node, false)
})

test('clusterToCannibalizationNode marks keyword_data_source estimated only when EVERY keyword is', () => {
  const allEst = clusterToCannibalizationNode({
    cluster_key: 'c', head_keyword: 'k', total_volume: 10,
    keywords: [{ keyword: 'k', keyword_data_source: 'llm-estimated' }, { keyword: 'k2', keyword_data_source: 'llm-estimated' }],
  })
  assert.equal(allEst._metrics.keyword_data_source, 'llm-estimated')
  const mixed = clusterToCannibalizationNode({
    cluster_key: 'c', head_keyword: 'k', total_volume: 10,
    keywords: [{ keyword: 'k', keyword_data_source: 'llm-estimated' }, { keyword: 'k2' }],
  })
  assert.equal(mixed._metrics.keyword_data_source, undefined)
})

test('buildPoolCannibalizationReport: pre-structure checks fire; slug_collision NEVER does', () => {
  const ctx = {
    existingKeywords: new Map([['taken kw', 'live-slug']]),
    existingSlugs: new Set(['would-be-slug']), // present, but no pool node has _slug
    existingTitleTokens: [],
  }
  const clusters = [
    { cluster_key: 'c1', head_keyword: 'alpha kw', total_volume: 500, keywords: [{ keyword: 'alpha kw' }] }, // clean
    { cluster_key: 'c2', head_keyword: 'alpha kw', total_volume: 400, keywords: [{ keyword: 'alpha kw' }] }, // intra_map_duplicate
    { cluster_key: 'c3', head_keyword: 'taken kw', total_volume: 200, keywords: [{ keyword: 'taken kw' }] },  // keyword_collision
    { cluster_key: 'c4', head_keyword: 'zeta kw', total_volume: 0, keywords: [{ keyword: 'zeta kw' }] },      // zero_demand
    { cluster_key: 'c5', head_keyword: 'eta kw', total_volume: 50, keywords: [{ keyword: 'eta kw', keyword_data_source: 'llm-estimated' }] }, // unverified_keyword
  ]
  const { report, nodes } = buildPoolCannibalizationReport(clusters, ctx)
  assert.deepEqual(report.counts, {
    intra_map_duplicate: 1,
    keyword_collision: 1,
    zero_demand: 1,
    unverified_keyword: 1,
  })
  assert.equal('slug_collision' in report.counts, false) // the key correctness property
  assert.equal(report.total_nodes, 5)
  assert.equal(report.clean_nodes, 1)
  assert.equal(nodes.length, 5)
  assert.equal(nodes[0]._cluster_key, 'c1') // nodes carry cluster_key for later filtering
})

test('buildPoolCannibalizationReport: empty clusters -> empty report', () => {
  const { report, nodes } = buildPoolCannibalizationReport([], {
    existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [],
  })
  assert.deepEqual(report, { flags: [], counts: {}, total_nodes: 0, clean_nodes: 0 })
  assert.deepEqual(nodes, [])
})
