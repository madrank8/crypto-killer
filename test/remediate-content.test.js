const { test } = require('node:test'); const assert = require('node:assert/strict')
const { remediateContent } = require('../lib/remediate-content')
const { DISCLOSURE_HEADING, hasRiskDisclosure } = require('../lib/ymyl-disclosure')

const BODY = '<h2>Intro</h2>\n<p>Some analysis.</p>'
const BIO = '<div class="author-bio"><p>By M. Webb</p></div>'

const disclosureFail = [{ key: 'missing_risk_or_ftc_disclosure', reason: 'no risk framing' }]

test('appends the disclosure to both bodies the site reads', () => {
  const row = { full_article: `${BODY}\n\n${BIO}`, sections: [{ heading: 'Intro', body: 'Some analysis.' }] }
  const { patch, applied, unfixable } = remediateContent(row, disclosureFail)

  assert.equal(unfixable.length, 0)
  assert.equal(applied.length, 1)
  assert.match(applied[0].what, /full_article and sections/)

  // full_article is what prerender.ts serves to crawlers; sections is what the
  // client BlogPostPage prefers. Writing one and not the other makes a YMYL
  // disclosure appear or vanish depending on how the page was loaded.
  assert.ok(hasRiskDisclosure(patch.full_article))
  assert.equal(patch.sections.at(-1).heading, DISCLOSURE_HEADING)
  assert.ok(hasRiskDisclosure(patch.sections.at(-1).body))
})

test('keeps the byline last by inserting before the author bio', () => {
  const row = { full_article: `${BODY}\n\n${BIO}`, sections: [] }
  const { patch } = remediateContent(row, disclosureFail)

  assert.ok(
    patch.full_article.indexOf('risk-disclosure') < patch.full_article.indexOf('author-bio'),
    'disclosure must precede the author bio so the byline stays last, as on every other article',
  )
})

test('appends at the end when there is no author bio block', () => {
  const row = { full_article: BODY, sections: [] }
  const { patch } = remediateContent(row, disclosureFail)

  assert.ok(patch.full_article.startsWith(BODY))
  assert.ok(hasRiskDisclosure(patch.full_article))
})

test('does not touch sections when the row has none', () => {
  const row = { full_article: BODY, sections: [] }
  const { patch, applied } = remediateContent(row, disclosureFail)

  assert.equal('sections' in patch, false)
  assert.match(applied[0].what, /full_article$/)
})

test('reports rather than duplicating when a disclosure already exists', () => {
  const row = { full_article: `${BODY}\n\n${BIO}`, sections: [{ heading: 'Intro', body: 'x' }] }
  const first = remediateContent(row, disclosureFail)

  const second = remediateContent(
    { ...row, full_article: first.patch.full_article, sections: first.patch.sections },
    disclosureFail,
  )

  // A second copy of a disclaimer is a visible defect on a live page, so the
  // disagreement goes to a human instead.
  assert.deepEqual(second.patch, {})
  assert.equal(second.applied.length, 0)
  assert.equal(second.unfixable[0].key, 'missing_risk_or_ftc_disclosure')
  assert.match(second.unfixable[0].operator_action, /already contains/)
})

test('recognises a disclosure worded by the reviews pipeline', () => {
  // The reviews pipeline has always appended its own block. Remediation must
  // not stack ours on top of it just because the wording differs.
  const row = {
    full_article: `${BODY}<p>This analysis is for informational purposes only and should not be considered financial advice.</p>`,
    sections: [],
  }
  const { applied, unfixable } = remediateContent(row, disclosureFail)

  assert.equal(applied.length, 0)
  assert.equal(unfixable.length, 1)
})

test('finds a disclosure that lives only in sections', () => {
  const row = {
    full_article: '',
    sections: [{ heading: 'Notes', body: 'Nothing here is financial advice.' }],
  }
  const { applied, unfixable } = remediateContent(row, disclosureFail)

  assert.equal(applied.length, 0)
  assert.match(unfixable[0].operator_action, /already contains/)
})

test('refuses to build a page whose only content is a disclaimer', () => {
  const { patch, applied, unfixable } = remediateContent({ full_article: '', sections: [] }, disclosureFail)

  assert.deepEqual(patch, {})
  assert.equal(applied.length, 0)
  assert.match(unfixable[0].operator_action, /Generate Article/)
})

test('reports every non-mechanical failure with a next action', () => {
  const fails = [
    { key: 'fabricated_source_or_stat', reason: 'untraceable 73% figure' },
    { key: 'commodity_no_information_gain', reason: 'no first-party evidence' },
    { key: 'not_for_you_block_present', reason: 'block missing' },
    { key: 'unverified_claims_in_article', reason: '2 unsupported claims' },
  ]
  const { patch, applied, unfixable } = remediateContent({ full_article: BODY }, fails)

  assert.deepEqual(patch, {})
  assert.equal(applied.length, 0)
  assert.equal(unfixable.length, fails.length)

  for (const item of unfixable) {
    // The reason already says what is wrong; the operator needs the next move.
    assert.ok(item.operator_action && item.operator_action.length > 20, `${item.key} has no usable operator action`)
    assert.ok(item.reason, `${item.key} lost its audit reason`)
  }
})

test('falls back to a usable action for an unrecognised check', () => {
  const { unfixable } = remediateContent({ full_article: BODY }, [{ key: 'some_future_check', reason: 'r' }])

  assert.equal(unfixable[0].key, 'some_future_check')
  assert.match(unfixable[0].operator_action, /ai_audit\.hard_fail_checks/)
})

test('a clean verdict produces no patch', () => {
  const { patch, applied, unfixable } = remediateContent({ full_article: BODY }, [])

  assert.deepEqual(patch, {})
  assert.deepEqual(applied, [])
  assert.deepEqual(unfixable, [])
})

test('tolerates a missing or malformed fail list', () => {
  for (const fails of [undefined, null, 'nope', {}]) {
    const out = remediateContent({ full_article: BODY }, fails)
    assert.deepEqual(out.patch, {})
    assert.deepEqual(out.unfixable, [])
  }
})

test('records a fail with no key rather than dropping it', () => {
  const { unfixable } = remediateContent({ full_article: BODY }, [{ reason: 'something went wrong' }])

  assert.equal(unfixable.length, 1)
  assert.equal(unfixable[0].key, 'unknown')
  assert.equal(unfixable[0].reason, 'something went wrong')
})

test('the disclosure states no chargeback window', () => {
  // Dispute windows vary by bank and card network; naming one invites the
  // fabricated_source_or_stat veto the disclosure is meant to clear.
  const { patch } = remediateContent({ full_article: BODY, sections: [] }, disclosureFail)

  assert.doesNotMatch(patch.full_article, /\b\d+\s*(?:calendar\s*|business\s*)?days?\b/i)
})

test('the disclosure carries both risk framing and a not-advice line', () => {
  // Either alone still trips the check.
  const { patch } = remediateContent({ full_article: BODY, sections: [] }, disclosureFail)

  assert.match(patch.full_article, /not financial, investment, legal, or tax advice/i)
  assert.match(patch.full_article, /high risk of total loss/i)
})

test('links bare ScamAdviser and IC3 mentions to ledger URLs', () => {
  const row = {
    full_article: '<p>ScamAdviser has documented fee loops. The FBI\'s IC3 has tied billions in losses.</p>',
    sections: [{ heading: 'A', body: 'ScamAdviser never sees the wallet.' }],
    sources: [
      { url: 'https://www.scamadviser.com/', title: 'ScamAdviser' },
      { url: 'https://www.ic3.gov/', title: 'IC3' },
    ],
  }
  const { patch, applied, unfixable } = remediateContent(row, [
    { key: 'source_ledger_claims_without_links', reason: '2 claims without links' },
  ])
  assert.equal(unfixable.length, 0)
  assert.equal(applied.length, 1)
  assert.match(patch.full_article, /href="https:\/\/www\.scamadviser\.com\/">ScamAdviser</)
  assert.match(patch.full_article, /href="https:\/\/www\.ic3\.gov\/">IC3</)
  assert.match(patch.sections[0].body, /href="https:\/\/www\.scamadviser\.com\/">ScamAdviser</)
})

test('does not double-link names already inside anchors', () => {
  const row = {
    full_article: '<p><a href="https://www.scamadviser.com/">ScamAdviser</a> already linked.</p>',
    sources: [{ url: 'https://www.scamadviser.com/', title: 'ScamAdviser' }],
  }
  const { applied, unfixable } = remediateContent(row, [
    { key: 'source_ledger_claims_without_links', reason: '1' },
  ])
  assert.equal(applied.length, 0)
  assert.equal(unfixable.length, 1)
})
