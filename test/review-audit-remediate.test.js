const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  remediateReviewAudit,
  ACTION_FRAUD_SOURCE,
} = require('../lib/review-audit-remediate')

const ACTION_FRAUD_FAILS = [
  {
    key: 'unverified_claims_in_article',
    reason:
      "unverified_claims_in_article = 1: the Action Fraud phone number '0300 123 2040' is a hard-coded literal in FAQ answer 5 with no Source Ledger entry",
  },
  {
    key: 'source_ledger_claims_without_links',
    reason: 'source_ledger_claims_without_links = 1 for the same Action Fraud phone item',
  },
]

function thistleLikeRow() {
  return {
    sources: [
      {
        url: 'https://www.ic3.gov/',
        type: 'government',
        title: 'FBI Internet Crime Complaint Center (IC3)',
      },
    ],
    faq: [
      {
        question: 'Can I get my money back?',
        answer:
          'Report the matter to Action Fraud (actionfraud.police.uk) in the UK.',
      },
      {
        question: 'My family member was targeted — what should I do?',
        answer:
          'Report to Action Fraud (0300 123 2040) and the FCA\'s consumer helpline.',
      },
    ],
    full_article: '<p>Call Action Fraud on 0300 123 2040 if you were targeted.</p>',
  }
}

test('adds Action Fraud to the source ledger and hyperlinks the phone', () => {
  const row = thistleLikeRow()
  const { patch, applied, unfixable } = remediateReviewAudit(row, ACTION_FRAUD_FAILS)

  assert.equal(unfixable.length, 0)
  assert.ok(applied.length >= 1)
  assert.ok(Array.isArray(patch.sources))
  assert.ok(
    patch.sources.some((s) => /actionfraud\.police\.uk/i.test(s.url)),
    'sources must include Action Fraud',
  )
  assert.equal(patch.sources.find((s) => /actionfraud/i.test(s.url)).url, ACTION_FRAUD_SOURCE.url)

  const faq5 = patch.faq.find((f) => /family member/i.test(f.question))
  assert.match(faq5.answer, /<a[^>]+href="https:\/\/www\.actionfraud\.police\.uk\/"[^>]*>0300 123 2040<\/a>/)

  assert.match(
    patch.full_article,
    /<a[^>]+href="https:\/\/www\.actionfraud\.police\.uk\/"[^>]*>0300 123 2040<\/a>/,
  )
})

test('hyperlinks bare actionfraud.police.uk text when unlinked', () => {
  const row = thistleLikeRow()
  const { patch } = remediateReviewAudit(row, ACTION_FRAUD_FAILS)
  const faq3 = patch.faq.find((f) => /money back/i.test(f.question))
  assert.match(
    faq3.answer,
    /<a[^>]+href="https:\/\/www\.actionfraud\.police\.uk\/"[^>]*>actionfraud\.police\.uk<\/a>/,
  )
})

test('is idempotent — second run applies nothing', () => {
  const row = thistleLikeRow()
  const first = remediateReviewAudit(row, ACTION_FRAUD_FAILS)
  const second = remediateReviewAudit(
    { ...row, ...first.patch },
    ACTION_FRAUD_FAILS,
  )

  assert.deepEqual(second.patch, {})
  assert.equal(second.applied.length, 0)
  assert.equal(second.unfixable.length, 0)
})

test('does not double-wrap an already-linked phone', () => {
  const row = {
    sources: [ACTION_FRAUD_SOURCE],
    faq: [
      {
        question: 'What should I do?',
        answer:
          'Report to Action Fraud (<a href="https://www.actionfraud.police.uk/">0300 123 2040</a>).',
      },
    ],
    full_article: '',
  }
  const { patch, applied } = remediateReviewAudit(row, ACTION_FRAUD_FAILS)
  assert.deepEqual(patch, {})
  assert.equal(applied.length, 0)
  assert.equal((row.faq[0].answer.match(/<a /g) || []).length, 1)
})

test('does not invent sources outside the allowlist for unrelated hard fails', () => {
  const row = thistleLikeRow()
  const { patch, applied, unfixable } = remediateReviewAudit(row, [
    {
      key: 'fabricated_source_or_stat',
      reason: 'Invented a "$47M seized" figure with no ledger entry',
    },
  ])

  assert.deepEqual(patch, {})
  assert.equal(applied.length, 0)
  assert.equal(unfixable.length, 1)
  assert.equal(unfixable[0].key, 'fabricated_source_or_stat')
  assert.match(unfixable[0].operator_action, /source|delete the claim/i)
})

test('infers Action Fraud fix from reason text when keys are generic', () => {
  const row = thistleLikeRow()
  const { patch, applied, unfixable } = remediateReviewAudit(row, [
    {
      key: 'any_hard_fail',
      reason:
        "Hard fail: the Action Fraud phone number '0300 123 2040' has no Source Ledger entry and no inline link",
    },
  ])

  assert.equal(unfixable.length, 0)
  assert.ok(applied.length >= 1)
  assert.ok(patch.sources?.some((s) => /actionfraud/i.test(s.url)))
})

test('reports remaining unfixable keys alongside a successful Action Fraud fix', () => {
  const row = thistleLikeRow()
  const { applied, unfixable } = remediateReviewAudit(row, [
    ...ACTION_FRAUD_FAILS,
    {
      key: 'commodity_no_information_gain',
      reason: 'No first-party evidence',
    },
  ])

  assert.ok(applied.length >= 1)
  assert.equal(unfixable.length, 1)
  assert.equal(unfixable[0].key, 'commodity_no_information_gain')
})

test('does not duplicate Action Fraud when domain already present', () => {
  const row = {
    ...thistleLikeRow(),
    sources: [
      {
        url: 'https://actionfraud.police.uk/report',
        type: 'government',
        title: 'Action Fraud report page',
      },
    ],
  }
  // Strip phone link need only — sources already have the domain
  const { patch } = remediateReviewAudit(row, ACTION_FRAUD_FAILS)
  const afSources = (patch.sources || row.sources).filter((s) =>
    /actionfraud\.police\.uk/i.test(s.url || ''),
  )
  assert.equal(afSources.length, 1)
})
