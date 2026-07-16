const { test } = require('node:test')
const assert = require('node:assert/strict')
const { slugify, tokenize, jaccard } = require('../../lib/topical-map/text-utils')

test('slugify: lowercases, hyphenates non-alnum, trims edges', () => {
  assert.equal(slugify('Crypto Scam Reviews!'), 'crypto-scam-reviews')
})

test('slugify: empty / punctuation-only falls back to "topic"', () => {
  assert.equal(slugify(''), 'topic')
  assert.equal(slugify('---'), 'topic')
  assert.equal(slugify(null), 'topic')
})

test('slugify: caps length at 180', () => {
  assert.equal(slugify('a'.repeat(200)).length, 180)
})

test('tokenize: lowercases, splits on non-alnum, drops tokens <= 2 chars', () => {
  assert.deepEqual([...tokenize('The Big Scam Review')], ['the', 'big', 'scam', 'review'])
})

test('tokenize: all-short input yields empty set', () => {
  assert.deepEqual([...tokenize('a to be it')], [])
  assert.equal(tokenize('').size, 0)
})

test('jaccard: intersection over union', () => {
  assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5)
})

test('jaccard: identical sets = 1, empty operand = 0', () => {
  assert.equal(jaccard(new Set(['x', 'y']), new Set(['x', 'y'])), 1)
  assert.equal(jaccard(new Set(), new Set(['a'])), 0)
})
