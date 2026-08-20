'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  autodraftDisabled,
  utcIsoWeekKey,
  weeklyCapReached,
  eligibleForAutodraft,
  pickNextDue,
  nextWriteStage,
  fillRequestBody,
  writeContentFingerprint,
} = require('../../lib/topical-map/map-writer')

const topic = (over = {}) => ({
  id: over.id || 't1',
  topic_type: 'supporting',
  title: 'Pig Butchering Scams: How They Work',
  target_keyword: 'pig butchering scam',
  content_status: 'planned',
  scheduled_for: '2026-08-20',
  priority_score: 80,
  ...over,
})

test('autodraftDisabled: AGENT_AUTODRAFT=0 or AGENT_RUNNER=0', () => {
  assert.equal(autodraftDisabled({}), false)
  assert.equal(autodraftDisabled({ AGENT_AUTODRAFT: '1' }), false)
  assert.equal(autodraftDisabled({ AGENT_AUTODRAFT: '0' }), true)
  assert.equal(autodraftDisabled({ AGENT_RUNNER: '0' }), true)
})

test('utcIsoWeekKey is stable in UTC', () => {
  assert.equal(utcIsoWeekKey('2026-08-20'), '2026-W34')
  assert.equal(utcIsoWeekKey('not-a-date'), null)
})

test('weeklyCapReached compares drafts this ISO week to cadence perWeek', () => {
  assert.equal(weeklyCapReached(0, 5), false)
  assert.equal(weeklyCapReached(5, 5), true)
  assert.equal(weeklyCapReached(4, 5), false)
})

test('eligibleForAutodraft requires writable + due + sullivan_ok + no existing article', () => {
  const briefs = new Map([['t1', { sullivan_ok: true }]])
  const today = '2026-08-20'
  assert.deepEqual(eligibleForAutodraft(topic(), { briefsById: briefs, today }), { ok: true })
  assert.equal(eligibleForAutodraft(topic({ topic_type: 'cluster', title: 'Folder' }), { briefsById: briefs, today }), false)
  assert.equal(eligibleForAutodraft(topic({ content_id: 'c1' }), { briefsById: briefs, today }), false)
  assert.equal(eligibleForAutodraft(topic({ review_id: 'r1' }), { briefsById: briefs, today }), false)
  assert.equal(eligibleForAutodraft(topic({ content_status: 'draft' }), { briefsById: briefs, today }), false)
  assert.equal(eligibleForAutodraft(topic({ scheduled_for: '2026-08-27' }), { briefsById: briefs, today }), false)
  assert.deepEqual(
    eligibleForAutodraft(topic(), { briefsById: new Map(), today }),
    { ok: false, reason: 'needs_sullivan' }
  )
  assert.deepEqual(
    eligibleForAutodraft(topic(), { briefsById: new Map([['t1', { sullivan_ok: false }]]), today }),
    { ok: false, reason: 'needs_sullivan' }
  )
})

test('pickNextDue sorts by scheduled_for then priority; blocked Sullivan is not next', () => {
  const briefs = new Map([
    ['early', { sullivan_ok: true }],
    ['hot', { sullivan_ok: true }],
    ['blocked', { sullivan_ok: false }],
  ])
  const { next, blocked, due } = pickNextDue(
    [
      topic({ id: 'hot', scheduled_for: '2026-08-20', priority_score: 99 }),
      topic({ id: 'early', scheduled_for: '2026-08-13', priority_score: 10 }),
      topic({ id: 'blocked', scheduled_for: '2026-08-13' }),
      topic({ id: 'folder', topic_type: 'cluster', title: 'Folder' }),
    ],
    { briefsById: briefs, today: '2026-08-20' }
  )
  assert.equal(next.id, 'early')
  assert.deepEqual(due.map((t) => t.id), ['early', 'hot'])
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].topic.id, 'blocked')
  assert.equal(blocked[0].reason, 'needs_sullivan')
})

test('nextWriteStage walks create → outline → fill → done; never publish', () => {
  assert.equal(nextWriteStage(null), 'create')
  assert.equal(nextWriteStage({ id: 'c1', sections: null, full_article: null }), 'outline')
  assert.equal(nextWriteStage({ id: 'c1', sections: [], full_article: '' }), 'outline')
  assert.equal(
    nextWriteStage({ id: 'c1', outline_sections: [{ heading: 'H2' }], full_article: '' }),
    'fill'
  )
  assert.equal(
    nextWriteStage({ id: 'c1', sections: [{ heading: 'H2' }], full_article: '<p>Hi</p>' }),
    'done'
  )
})

test('fillRequestBody never enables auto_publish', () => {
  assert.deepEqual(fillRequestBody('c-9'), { content_id: 'c-9', auto_publish: false })
})

test('writeContentFingerprint is stable per topic', () => {
  assert.equal(writeContentFingerprint('abc'), 'write_content:abc')
})
