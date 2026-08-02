const { test } = require('node:test'); const assert = require('node:assert/strict')
const { computeAuditHash, stampAudit, auditFreshness } = require('../lib/audit-freshness')

// A minimally realistic row: enough audited fields to exercise the projection,
// plus one field the auditor never reads.
function row(overrides = {}) {
  return {
    title: 'Is Kraken Legit?',
    headline: 'Is Kraken Legit? What the Filings Show',
    meta_description: 'A look at the filings.',
    summary: 'Short summary.',
    sections: [{ heading: 'Intro', body: 'x'.repeat(60) }],
    faq: [],
    full_article: '<p>body</p>',
    internal_links: [{ target_slug: 'a', anchor_text: 'A' }],
    item_reviewed: null,
    not_for_you: 'Not for day traders.',
    information_gain_summary: 'Original chargeback data.',
    verify_tags_count: 3,
    claims: [],
    sources: [{ url: 'https://example.com', accessed_date: '2026-08-01' }],
    schema_json: {},
    hero_image_credit: 'Higgsfield',
    ...overrides,
  }
}

test('a stamped verdict is fresh against the row it was stamped on', () => {
  const r = row()
  r.ai_audit = stampAudit({ overall_score: 82 }, r)

  const f = auditFreshness(r)
  assert.equal(f.state, 'fresh')
  assert.equal(f.expected_hash, f.actual_hash)
  assert.ok(f.audited_at, 'stamping records when the audit ran')
})

test('stampAudit preserves the verdict it stamps', () => {
  const stamped = stampAudit({ overall_score: 82, hard_fail_checks: { any_hard_fail: false } }, row())
  assert.equal(stamped.overall_score, 82)
  assert.deepEqual(stamped.hard_fail_checks, { any_hard_fail: false })
})

test('editing an audited field makes the verdict stale', () => {
  const before = row()
  const r = { ...before, ai_audit: stampAudit({}, before) }

  // The editor fixes the missing disclosure the auditor complained about.
  r.full_article = '<p>body</p><p>Not financial advice.</p>'

  assert.equal(auditFreshness(r).state, 'stale')
})

test('editing a field the auditor never reads keeps the verdict fresh', () => {
  const before = row()
  const r = { ...before, ai_audit: stampAudit({}, before) }

  // Swapping the hero credit cannot invalidate a verdict about the prose.
  r.hero_image_credit = 'Midjourney'

  assert.equal(auditFreshness(r).state, 'fresh')
})

test('a verdict with no content_hash is unverifiable, not fresh and not stale', () => {
  // Every row audited before stamping existed looks like this. Reporting it as
  // fresh would silently trust an unprovable verdict; reporting it as stale
  // would let any legacy row bypass the gate.
  const r = row({ ai_audit: { overall_score: 41, hard_fail_checks: { any_hard_fail: true } } })

  const f = auditFreshness(r)
  assert.equal(f.state, 'unverifiable')
  assert.equal(f.expected_hash, null)
  assert.equal(f.audited_at, null)
})

test('a row with no audit at all is unverifiable', () => {
  assert.equal(auditFreshness(row()).state, 'unverifiable')
  assert.equal(auditFreshness({}).state, 'unverifiable')
  assert.equal(auditFreshness(null).state, 'unverifiable')
})

test('JSONB key order does not affect the hash', () => {
  // Postgres does not preserve object key order in jsonb, so the same section
  // can come back with keys in a different order on the next read. An
  // order-sensitive hash would report that as an edit.
  const a = row({ sections: [{ heading: 'Intro', body: 'x' }] })
  const b = row({ sections: [{ body: 'x', heading: 'Intro' }] })

  assert.equal(computeAuditHash(a), computeAuditHash(b))
})

test('array order DOES affect the hash', () => {
  // Reordering sections is a real editorial change, not a serialization artifact.
  const a = row({ sections: [{ heading: 'One' }, { heading: 'Two' }] })
  const b = row({ sections: [{ heading: 'Two' }, { heading: 'One' }] })

  assert.notEqual(computeAuditHash(a), computeAuditHash(b))
})

test('an absent audited field hashes the same as an explicitly null one', () => {
  // Supabase returns nulls for unset columns, but the auditor's reviewContent
  // objects sometimes omit a key entirely. Both mean "no value".
  const explicit = row({ item_reviewed: null })
  const absent = row()
  delete absent.item_reviewed

  assert.equal(computeAuditHash(explicit), computeAuditHash(absent))
})

test('every audited field is actually covered by the hash', () => {
  // Guards the failure mode this module exists to prevent: an auditor input
  // that drifts without the freshness check noticing. If a field is added to
  // the auditor's payload but not to AUDITED_FIELDS, this fails.
  const base = row()
  const audited = [
    'headline', 'title', 'meta_description', 'summary', 'sections', 'faq',
    'full_article', 'internal_links', 'item_reviewed', 'not_for_you',
    'information_gain_summary', 'verify_tags_count', 'claims', 'sources',
    'schema_json',
  ]

  for (const field of audited) {
    const changed = { ...base, [field]: '__mutated__' }
    assert.notEqual(
      computeAuditHash(changed),
      computeAuditHash(base),
      `${field} is an auditor input but changing it does not change the hash`,
    )
  }
})
