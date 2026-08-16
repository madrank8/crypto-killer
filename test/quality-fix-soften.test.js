const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  softenHardFails,
  extractClaimSpans,
  removeSentencesContainingSpans,
} = require('../lib/quality-fix-soften')

test('extractClaimSpans pulls quotes and figures from auditor reasons', () => {
  const spans = extractClaimSpans(
    'Claim "FBI reports $5.6 billion in losses" is not supported; also 73% figure',
  )
  assert.ok(spans.some((s) => /FBI reports/.test(s)))
  assert.ok(spans.some((s) => /5\.6/.test(s) || /73%/.test(s)))
})

test('removeSentencesContainingSpans drops the sentence with the span', () => {
  const html =
    '<p>Safe intro. FBI reports $5.6 billion in losses according to analysts. Safe outro.</p>'
  const { html: out, removed } = removeSentencesContainingSpans(html, [
    'FBI reports $5.6 billion in losses',
  ])
  assert.ok(removed >= 1)
  assert.match(out, /Safe intro/)
  assert.match(out, /Safe outro/)
  assert.doesNotMatch(out, /\$5\.6 billion/)
})

test('softenHardFails removes auditor-quoted claim and strips VERIFY markers', () => {
  const row = {
    full_article:
      '<p>{{VERIFY}}ScamAdviser scores this domain 1/100.{{/VERIFY}} Other prose stays.</p>',
    sections: [{ heading: 'A', body: 'Updated 2026 guide text with more.' }],
  }
  const out = softenHardFails(row, [
    {
      key: 'fabricated_source_or_stat',
      reason: 'Claim "ScamAdviser scores this domain 1/100" is fabricated',
    },
    {
      key: 'fake_or_unmarked_freshness',
      reason: 'Updated 2026 framing without substantive update',
    },
  ])
  assert.equal(out.touched, true)
  assert.ok(out.applied.length >= 1)
  assert.doesNotMatch(out.patch.full_article, /ScamAdviser scores this domain/)
  assert.doesNotMatch(out.patch.full_article, /\{\{VERIFY/)
  assert.match(out.patch.full_article, /Other prose stays/)
  assert.doesNotMatch(out.patch.sections[0].body, /Updated 2026/i)
})

test('softenHardFails refuses commodity_no_information_gain', () => {
  const out = softenHardFails(
    { full_article: '<p>Generic advice.</p>' },
    [{ key: 'commodity_no_information_gain', reason: 'no first-party evidence' }],
  )
  assert.equal(out.touched, false)
  assert.equal(out.unfixable.length, 1)
  assert.equal(out.unfixable[0].key, 'commodity_no_information_gain')
})
