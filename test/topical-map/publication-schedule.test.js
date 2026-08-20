'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isSchedulableTopic,
  assignScheduledFor,
  publicationConfig,
} = require('../../lib/topical-map/publication-schedule')

const supporting = (over = {}) => ({
  id: over.id || 's1',
  topic_type: 'supporting',
  title: over.title || 'Pig Butchering Scams: How They Work',
  target_keyword: over.target_keyword || 'pig butchering scam',
  content_status: over.content_status || 'planned',
  publication_wave: over.publication_wave ?? 1,
  priority_score: over.priority_score ?? 80,
  sort_order: over.sort_order ?? 0,
  ...over,
})

test('isSchedulableTopic: writable unpublished supporting pages only', () => {
  assert.equal(isSchedulableTopic(supporting()), true)
  assert.equal(isSchedulableTopic(supporting({ topic_type: 'cluster', title: 'Scam Types' })), false)
  assert.equal(isSchedulableTopic(supporting({ topic_type: 'pillar', title: 'Crypto Scams' })), false)
  assert.equal(
    isSchedulableTopic(supporting({ qa_flags: [{ type: 'synthetic_hub' }] })),
    false
  )
  assert.equal(isSchedulableTopic(supporting({ content_id: 'c-1' })), false)
  assert.equal(isSchedulableTopic(supporting({ review_id: 'r-1' })), false)
  assert.equal(isSchedulableTopic(supporting({ content_status: 'published' })), false)
  assert.equal(isSchedulableTopic(supporting({ rolling_placeholder: true })), false)
})

test('title-tag pillars with a keyword are schedulable', () => {
  assert.equal(
    isSchedulableTopic({
      id: 'p1',
      topic_type: 'pillar',
      title: 'Crypto Scam Checker: Free Tool',
      target_keyword: 'crypto scam checker',
      content_status: 'planned',
    }),
    true
  )
})

test('assignScheduledFor writes the same dates for the same inputs', () => {
  const topics = [
    supporting({ id: 'a', publication_wave: 1, priority_score: 90, sort_order: 1 }),
    supporting({ id: 'b', publication_wave: 1, priority_score: 90, sort_order: 0 }),
    supporting({ id: 'c', publication_wave: 2, priority_score: 10 }),
    supporting({ id: 'skip', topic_type: 'cluster', title: 'Folder' }),
    supporting({ id: 'linked', content_id: 'c-9' }),
  ]
  const a = assignScheduledFor(topics, { cadence: 'established', startDate: '2026-08-20' })
  const b = assignScheduledFor(topics, { cadence: 'established', startDate: '2026-08-20' })
  assert.deepEqual([...a.assignments.entries()], [...b.assignments.entries()])
  assert.equal(a.assignments.get('b'), '2026-08-20') // sort_order 0 before 1 at same priority
  assert.equal(a.assignments.get('a'), '2026-08-20')
  assert.equal(a.assignments.get('c'), '2026-08-27') // established = 2/week, third topic is week 2
  assert.equal(a.assignments.has('skip'), false)
  assert.equal(a.assignments.has('linked'), false)
  assert.equal(a.config.cadence, 'established')
  assert.equal(a.config.start_date, '2026-08-20')
  assert.equal(a.config.perWeek, 2)
})

test('assignScheduledFor never invents a date when startDate is missing', () => {
  const { assignments, config } = assignScheduledFor([supporting()], {})
  assert.equal(config.start_date, null)
  assert.equal(assignments.get('s1'), null)
})

test('publicationConfig falls back to growing and ignores bad perWeek', () => {
  assert.equal(publicationConfig({}).cadence, 'growing')
  assert.equal(publicationConfig({ cadence: 'nope' }).cadence, 'growing')
  assert.ok(publicationConfig({ perWeek: 0 }).perWeek > 0)
})
