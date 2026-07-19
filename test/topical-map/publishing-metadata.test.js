const { test } = require('node:test'); const assert = require('node:assert/strict')
const {
  buildUrlPath, CONTENT_FORMATS, classifyContentFormat, SCHEMA_TYPES, classifySchemaType,
} = require('../../lib/topical-map/publishing-metadata')

// ── buildUrlPath ────────────────────────────────────────────────────────────
test('url path: hierarchical with no word repetition (skill example)', () => {
  assert.equal(buildUrlPath(['casino-reviews', 'stake-us-casino-review']), '/casino-reviews/stake-us/')
})
test('url path: clean hierarchy passes through', () => {
  assert.equal(buildUrlPath(['crypto-scams', 'rug-pull', 'how-to-report']), '/crypto-scams/rug-pull/how-to-report/')
})
test('url path: a segment fully consumed by dedup is dropped', () => {
  assert.equal(buildUrlPath(['guides', 'guides']), '/guides/')
})
test('url path: single leaf', () => assert.equal(buildUrlPath(['bitcoin-recovery']), '/bitcoin-recovery/'))
test('url path: empty / non-array -> root', () => {
  assert.equal(buildUrlPath([]), '/')
  assert.equal(buildUrlPath(null), '/')
  assert.equal(buildUrlPath(['', '   ']), '/')
})
test('url path: slugifies raw titles and dedups across segments', () => {
  assert.equal(buildUrlPath(['Crypto Scams', 'Crypto Scam Warning Signs']), '/crypto-scams/warning-signs/')
})

// ── classifyContentFormat ─────────────────────────────────────────────────────
test('CONTENT_FORMATS excludes domain-inapplicable medical formats', () => {
  assert.ok(!CONTENT_FORMATS.includes('Clinical Evidence Review'))
  assert.ok(!CONTENT_FORMATS.includes('Symptom Checklist'))
  assert.ok(CONTENT_FORMATS.includes('Evergreen Article'))
})
test('content format: format_code is the primary signal', () => {
  assert.equal(classifyContentFormat({ format_code: 'COMP' }), 'Comparison Table')
  assert.equal(classifyContentFormat({ format_code: 'HOWTO' }), 'Step-by-step Guide')
  assert.equal(classifyContentFormat({ format_code: 'LIST' }), 'Listicle')
  assert.equal(classifyContentFormat({ format_code: 'DEF' }), 'FAQ Hub')
  assert.equal(classifyContentFormat({ format_code: 'glossary' }), 'FAQ Hub') // case-insensitive
  assert.equal(classifyContentFormat({ format_code: 'TOOL' }), 'Calculator / Interactive Tool')
  assert.equal(classifyContentFormat({ format_code: 'NEWS' }), 'News / Update')
  assert.equal(classifyContentFormat({ format_code: 'GUIDE' }), 'Evergreen Article')
  assert.equal(classifyContentFormat({ format_code: 'REVIEW' }), 'Evergreen Article')
})
test('content format: format_code wins over intent/node_type', () => {
  assert.equal(classifyContentFormat({ format_code: 'COMP', search_intent: 'commercial', node_type: 'trending' }), 'Comparison Table')
})
test('content format: fallbacks when no format_code', () => {
  assert.equal(classifyContentFormat({ content_type: 'brand_review' }), 'Evergreen Article')
  assert.equal(classifyContentFormat({ search_intent: 'commercial' }), 'Landing Page (Commercial)')
  assert.equal(classifyContentFormat({ search_intent: 'transactional' }), 'Landing Page (Commercial)')
  assert.equal(classifyContentFormat({ node_type: 'trending' }), 'News / Update')
  assert.equal(classifyContentFormat({ node_type: 'quality' }), 'Evergreen Article')
  assert.equal(classifyContentFormat({}), 'Evergreen Article')
})
test('content format: unknown format_code falls through to fallbacks', () => {
  assert.equal(classifyContentFormat({ format_code: 'ZZZ', search_intent: 'commercial' }), 'Landing Page (Commercial)')
})
test('every content-format output is in the taxonomy', () => {
  const codes = ['DEF', 'GLOSSARY', 'HOWTO', 'LIST', 'COMP', 'REVIEW', 'GUIDE', 'NEWS', 'TOOL', 'ZZZ', '']
  for (const c of codes) assert.ok(CONTENT_FORMATS.includes(classifyContentFormat({ format_code: c })), `format for ${c}`)
})

// ── classifySchemaType ────────────────────────────────────────────────────────
test('schema type: brand_review -> Review (highest precedence)', () => {
  assert.equal(classifySchemaType({ content_type: 'brand_review', format_code: 'DEF' }), 'Review')
})
test('schema type: mapped from format_code', () => {
  assert.equal(classifySchemaType({ format_code: 'DEF' }), 'FAQPage')
  assert.equal(classifySchemaType({ format_code: 'HOWTO' }), 'HowTo')
  assert.equal(classifySchemaType({ format_code: 'COMP' }), 'ItemList')
  assert.equal(classifySchemaType({ format_code: 'LIST' }), 'ItemList')
  assert.equal(classifySchemaType({ format_code: 'REVIEW' }), 'Review')
  assert.equal(classifySchemaType({ format_code: 'NEWS' }), 'NewsArticle')
  assert.equal(classifySchemaType({ format_code: 'TOOL' }), 'WebApplication')
})
test('schema type: default Article for unknown/missing', () => {
  assert.equal(classifySchemaType({ format_code: 'GUIDE' }), 'Article')
  assert.equal(classifySchemaType({ format_code: 'ZZZ' }), 'Article')
  assert.equal(classifySchemaType({}), 'Article')
})
test('every schema-type output is in the taxonomy', () => {
  const codes = ['DEF', 'GLOSSARY', 'HOWTO', 'LIST', 'COMP', 'REVIEW', 'NEWS', 'TOOL', 'GUIDE', 'ZZZ', '']
  for (const c of codes) assert.ok(SCHEMA_TYPES.includes(classifySchemaType({ format_code: c })), `schema for ${c}`)
})
