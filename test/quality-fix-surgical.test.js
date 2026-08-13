const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applySurgicalPatches } = require('../lib/quality-fix-surgical')

test('replace_span rewrites the exact span once', () => {
  const row = { full_article: '<p>Lost $2M last year.</p>', sources: [] }
  const { patch, applied, rejected } = applySurgicalPatches(row, [
    { op: 'replace_span', field: 'full_article', find: 'Lost $2M last year.', replace: 'Victims reported large losses.' },
  ])
  assert.equal(rejected.length, 0)
  assert.equal(applied.length, 1)
  assert.match(patch.full_article, /Victims reported large losses/)
  assert.doesNotMatch(patch.full_article, /\$2M/)
})

test('rejects replace_span that invents a new URL host', () => {
  const row = { full_article: '<p>See report.</p>', sources: [{ url: 'https://ic3.gov/a' }] }
  const { rejected } = applySurgicalPatches(row, [
    { op: 'replace_span', field: 'full_article', find: 'See report.', replace: 'See https://evil.example/x .' },
  ])
  assert.ok(rejected.some((r) => /url|host/i.test(r.why)))
})

test('rejects replace_span that invents a new multi-digit number', () => {
  const row = { full_article: '<p>Lost money.</p>', sources: [] }
  const { rejected } = applySurgicalPatches(row, [
    { op: 'replace_span', field: 'full_article', find: 'Lost money.', replace: 'Lost $950000.' },
  ])
  assert.ok(rejected.some((r) => /number|stat/i.test(r.why)))
})

test('insert_ledger_link only allows existing source URLs', () => {
  const row = {
    full_article: '<p>FBI warns about pig butchering.</p>',
    sources: [{ url: 'https://www.ic3.gov/PSA/2023/PSA230928' }],
  }
  const ok = applySurgicalPatches(row, [
    { op: 'insert_ledger_link', field: 'full_article', find: 'FBI warns', url: 'https://www.ic3.gov/PSA/2023/PSA230928' },
  ])
  assert.equal(ok.rejected.length, 0)
  assert.match(ok.patch.full_article, /ic3\.gov/)

  const bad = applySurgicalPatches(row, [
    { op: 'insert_ledger_link', field: 'full_article', find: 'FBI warns', url: 'https://not-in-ledger.example/' },
  ])
  assert.ok(bad.rejected.length > 0)
})

test('rejects set_section_body that invents a new URL host', () => {
  const row = {
    sections: [{ heading: 'Risks', body: '<p>Scammers use pressure tactics.</p>' }],
    sources: [{ url: 'https://ic3.gov/a' }],
  }
  const { rejected } = applySurgicalPatches(row, [
    {
      op: 'set_section_body',
      index: 0,
      body: '<p>See https://evil.example/report for details.</p>',
    },
  ])
  assert.ok(rejected.some((r) => /url|host/i.test(r.why)))
})

test('rejects set_section_body that invents a new multi-digit number', () => {
  const row = {
    sections: [{ heading: 'Losses', body: '<p>Victims reported large losses.</p>' }],
    sources: [],
  }
  const { rejected } = applySurgicalPatches(row, [
    {
      op: 'set_section_body',
      index: 0,
      body: '<p>Victims reported $950000 in losses.</p>',
    },
  ])
  assert.ok(rejected.some((r) => /number|stat/i.test(r.why)))
})

test('accepts set_section_body safe rewrite without new hosts or numbers', () => {
  const row = {
    sections: [{ heading: 'Summary', body: '<p>Lost $2M last year.</p>' }],
    sources: [],
  }
  const { patch, applied, rejected } = applySurgicalPatches(row, [
    {
      op: 'set_section_body',
      index: 0,
      body: '<p>Victims reported large losses last year.</p>',
    },
  ])
  assert.equal(rejected.length, 0)
  assert.equal(applied.length, 1)
  assert.match(patch.sections[0].body, /Victims reported large losses/)
  assert.doesNotMatch(patch.sections[0].body, /\$2M/)
})

test('remove_source_urls drops matching sources', () => {
  const row = {
    full_article: '<p>x</p>',
    sources: [{ url: 'https://dead.example/a' }, { url: 'https://ok.example/b' }],
  }
  const { patch } = applySurgicalPatches(row, [
    { op: 'remove_source_urls', urls: ['https://dead.example/a'] },
  ])
  assert.equal(patch.sources.length, 1)
  assert.equal(patch.sources[0].url, 'https://ok.example/b')
})
