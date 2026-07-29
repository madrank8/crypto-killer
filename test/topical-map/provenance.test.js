const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  PROVENANCE, normalize, provenanceOf, isGrounded, ungroundedValues, buildProvenance, fromKeywordDataSource, keywordMetricProvenance,
} = require('../../lib/topical-map/provenance')

test('PROVENANCE has the three levels and is frozen', () => {
  assert.equal(PROVENANCE.MEASURED, 'measured')
  assert.equal(PROVENANCE.ESTIMATED, 'estimated')
  assert.equal(PROVENANCE.UNRESOLVED, 'unresolved')
  assert.ok(Object.isFrozen(PROVENANCE))
})

test('normalize: valid passes through, everything else is unresolved', () => {
  assert.equal(normalize('measured'), 'measured')
  assert.equal(normalize('estimated'), 'estimated')
  assert.equal(normalize('unresolved'), 'unresolved')
  assert.equal(normalize('MEASURED'), 'unresolved') // case-sensitive on purpose
  assert.equal(normalize('guess'), 'unresolved')
  assert.equal(normalize(null), 'unresolved')
  assert.equal(normalize(undefined), 'unresolved')
  assert.equal(normalize(42), 'unresolved')
})

test('provenanceOf: missing field or bad map is unresolved', () => {
  assert.equal(provenanceOf({ search_volume: 'measured' }, 'search_volume'), 'measured')
  assert.equal(provenanceOf({ search_volume: 'measured' }, 'keyword_difficulty'), 'unresolved')
  assert.equal(provenanceOf(null, 'x'), 'unresolved')
  assert.equal(provenanceOf(undefined, 'x'), 'unresolved')
  assert.equal(provenanceOf({ x: 'garbage' }, 'x'), 'unresolved')
})

test('isGrounded: true only for measured/estimated', () => {
  assert.equal(isGrounded({ a: 'measured' }, 'a'), true)
  assert.equal(isGrounded({ a: 'estimated' }, 'a'), true)
  assert.equal(isGrounded({ a: 'unresolved' }, 'a'), false)
  assert.equal(isGrounded({}, 'a'), false) // absence is not trust
})

test('ungroundedValues: flags fields with a value but no grounding', () => {
  const topic = { search_volume: 500, keyword_difficulty: 12, rpp_score: null, cpc: 0 }
  const prov = { search_volume: 'measured', keyword_difficulty: 'unresolved' }
  const fields = ['search_volume', 'keyword_difficulty', 'rpp_score', 'cpc']
  // search_volume: has value + measured -> ok (not flagged)
  // keyword_difficulty: has value + unresolved -> FLAGGED
  // rpp_score: null value -> not flagged even though unresolved
  // cpc: value 0 is a real value, provenance absent -> FLAGGED
  assert.deepEqual(ungroundedValues(topic, prov, fields), ['keyword_difficulty', 'cpc'])
})

test('ungroundedValues: empty string counts as no value', () => {
  assert.deepEqual(ungroundedValues({ x: '' }, {}, ['x']), [])
})

test('buildProvenance normalizes every entry', () => {
  assert.deepEqual(
    buildProvenance({ a: 'measured', b: 'guess', c: null }),
    { a: 'measured', b: 'unresolved', c: 'unresolved' }
  )
  assert.deepEqual(buildProvenance(null), {})
})

test('fromKeywordDataSource maps the pipeline vocab to provenance levels', () => {
  assert.equal(fromKeywordDataSource('dataforseo'), 'measured')
  assert.equal(fromKeywordDataSource('ahrefs'), 'measured') // Ahrefs is a real tool source
  assert.equal(fromKeywordDataSource('dataforseo+ahrefs'), 'measured') // compound (gap backfill)
  assert.equal(fromKeywordDataSource('llm-estimated'), 'estimated')
  assert.equal(fromKeywordDataSource('spreadsheet'), 'estimated')
  assert.equal(fromKeywordDataSource('unverified'), 'unresolved')
  assert.equal(fromKeywordDataSource('something-else'), 'unresolved')
  assert.equal(fromKeywordDataSource(null), 'unresolved')
})
test('keywordMetricProvenance tags all five metrics', () => {
  assert.deepEqual(keywordMetricProvenance('dataforseo'), { search_volume:'measured', keyword_difficulty:'measured', cpc:'measured', volume_trend_yearly:'measured', traffic_potential:'measured' })
  assert.equal(keywordMetricProvenance('llm-estimated').cpc, 'estimated')
  assert.equal(keywordMetricProvenance('spreadsheet').search_volume, 'estimated')
  assert.equal(keywordMetricProvenance('unverified').search_volume, 'unresolved')
})
