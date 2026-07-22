const { test } = require('node:test'); const assert = require('node:assert/strict')
const { secEdgarLookup } = require('../lib/source-verify')

// Stub global.fetch to return a canned EDGAR full-text response.
function withFetch(total, fn) {
  const orig = global.fetch
  global.fetch = async () => ({ ok: true, json: async () => ({ hits: { total: { value: total } } }) })
  return Promise.resolve(fn()).finally(() => { global.fetch = orig })
}

test('a nonzero EDGAR full-text result NEVER exposes the raw count in writer-facing text', () =>
  withFetch(239, async () => {
    const entry = await secEdgarLookup('Quantum AI')
    assert.ok(entry, 'expected a ledger entry')
    // The misleading, driftable count must not appear in prose the writer reads.
    assert.doesNotMatch(entry.extract, /239|\d{2,}/)
    assert.doesNotMatch(entry.relevance, /239|\d{2,}/)
    // It must be framed qualitatively and NOT as a registration/action signal.
    assert.match(entry.relevance, /not evidence of SEC registration/i)
    assert.match(entry.extract, /not evidence/i)
    // The raw count is still available internally for deterministic use.
    assert.equal(entry.lookup.hits, 239)
    assert.equal(entry.lookup.registry, 'sec_edgar_fts')
  }))

test('zero-hit EDGAR result reports no filing footprint', () =>
  withFetch(0, async () => {
    const entry = await secEdgarLookup('Quantum AI')
    assert.ok(entry)
    assert.match(entry.relevance, /no SEC filing footprint/i)
    assert.equal(entry.lookup.hits, 0)
  }))
