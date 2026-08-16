const { test } = require('node:test')
const assert = require('node:assert/strict')
const { researchSourcesForClaims, mergeVerifiedSources } = require('../lib/quality-fix-research')

test('drops sources whose head check fails', async () => {
  const callModelFn = async () => ({
    text: JSON.stringify({
      sources: [
        { url: 'https://dead.example/x', title: 'Dead', type: 'government', extract: '...' },
        { url: 'https://www.ic3.gov/ok', title: 'IC3', type: 'government', extract: 'PSA' },
      ],
    }),
  })
  const headCheckFn = async (url) => ({ ok: url.includes('ic3.gov') })
  const { sources, rejected } = await researchSourcesForClaims({
    claims: [{ text: '72-hour liquidity unlock' }],
    topicTitle: 'Crypto scam checker',
    existingUrls: new Set(),
    callModelFn,
    headCheckFn,
  })
  assert.equal(sources.length, 1)
  assert.equal(sources[0].url, 'https://www.ic3.gov/ok')
  assert.equal(rejected.length, 1)
})

test('mergeVerifiedSources appends without duplicating URLs', () => {
  const row = { sources: [{ url: 'https://a.example/' }] }
  const merged = mergeVerifiedSources(row, [
    { url: 'https://a.example/', title: 'dup' },
    { url: 'https://b.example/', title: 'new', type: 'government' },
  ])
  assert.equal(merged.sources.length, 2)
})
