const { test } = require('node:test')
const assert = require('node:assert/strict')
const { tokenize } = require('../../lib/topical-map/text-utils')
const { buildCannibalizationReport } = require('../../lib/topical-map/cannibalization')

// Context mirrors what stageQa builds from the DB.
function ctx() {
  return {
    existingKeywords: new Map([['taken kw', 'live-topic-slug']]),
    existingSlugs: new Set(['dup-slug']),
    existingTitleTokens: [
      { title: 'Crypto Recovery Scams Explained', tokens: tokenize('Crypto Recovery Scams Explained') },
    ],
  }
}

test('every flag type fires on the right node; exemptions keep nodes clean', () => {
  const nodes = [
    { title: 'Alpha Guide', target_keyword: 'alpha kw', _slug: 'alpha', _metrics: { search_volume: 500 }, content_type: 'guide' },   // clean
    { title: 'Beta Guide', target_keyword: 'alpha kw', _slug: 'beta', _metrics: { search_volume: 400 }, content_type: 'guide' },     // intra_map_duplicate
    { title: 'Gamma', target_keyword: 'taken kw', _slug: 'gamma', _metrics: { search_volume: 200 }, content_type: 'guide' },         // keyword_collision
    { title: 'Delta', target_keyword: 'delta kw', _slug: 'dup-slug', _metrics: { search_volume: 100 }, content_type: 'guide' },      // slug_collision
    { title: 'Crypto Recovery Scams Explained Fully', target_keyword: 'eps kw', _slug: 'eps', _metrics: { search_volume: 300 }, content_type: 'guide' }, // title_similarity
    { title: 'Zeta', target_keyword: 'zeta kw', _slug: 'zeta', _metrics: { search_volume: 0 }, content_type: 'guide' },              // zero_demand
    { title: 'Eta', target_keyword: 'eta kw', _slug: 'eta', _metrics: { search_volume: 50, keyword_data_source: 'llm-estimated' }, content_type: 'guide' }, // unverified_keyword
    { title: 'Theta Review', target_keyword: 'theta kw', _slug: 'theta', _metrics: { search_volume: 0 }, content_type: 'brand_review' }, // zero-demand EXEMPT -> clean
  ]
  const r = buildCannibalizationReport(nodes, ctx())
  assert.deepEqual(r.counts, {
    intra_map_duplicate: 1,
    keyword_collision: 1,
    slug_collision: 1,
    title_similarity: 1,
    zero_demand: 1,
    unverified_keyword: 1,
  })
  assert.equal(r.total_nodes, 8)
  assert.equal(r.clean_nodes, 2) // Alpha (clean) + Theta (brand_review exempt)
  // Pin WHICH node gets each flag (not just the counts) so a future reorder
  // that changes iteration order or population is caught, not silently passed.
  assert.deepEqual(
    r.flags.map((f) => [f.slug, f.type]),
    [
      ['beta', 'intra_map_duplicate'],
      ['gamma', 'keyword_collision'],
      ['dup-slug', 'slug_collision'],
      ['eps', 'title_similarity'],
      ['zeta', 'zero_demand'],
      ['eta', 'unverified_keyword'],
    ]
  )
})

test('expands_slug exemption: declaring the page you extend suppresses keyword_collision', () => {
  const nodes = [
    { title: 'X', target_keyword: 'taken kw', expands_slug: 'live-topic-slug', _slug: 'x', _metrics: { search_volume: 100 }, content_type: 'guide' },
  ]
  const r = buildCannibalizationReport(nodes, ctx())
  assert.deepEqual(r.counts, {})
  assert.equal(r.clean_nodes, 1)
})

test('traffic_potential rescues zero search_volume from zero_demand', () => {
  const nodes = [
    { title: 'Y', target_keyword: 'y kw', _slug: 'y', _metrics: { search_volume: 0, traffic_potential: 80 }, content_type: 'guide' },
  ]
  const r = buildCannibalizationReport(nodes, { existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [] })
  assert.deepEqual(r.counts, {})
})

test('empty node list yields an empty report', () => {
  const r = buildCannibalizationReport([], { existingKeywords: new Map(), existingSlugs: new Set(), existingTitleTokens: [] })
  assert.deepEqual(r, { flags: [], counts: {}, total_nodes: 0, clean_nodes: 0 })
})

test('mutates node._qa_flags on flagged nodes', () => {
  const node = { title: 'Dup', target_keyword: 'k', _slug: 'dup-slug', _metrics: { search_volume: 100 }, content_type: 'guide' }
  buildCannibalizationReport([node], { existingKeywords: new Map(), existingSlugs: new Set(['dup-slug']), existingTitleTokens: [] })
  assert.equal(node._qa_flags.length, 1)
  assert.equal(node._qa_flags[0].type, 'slug_collision')
})
