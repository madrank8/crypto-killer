const { test } = require('node:test'); const assert = require('node:assert/strict')
const { CADENCES, DEFAULT_CADENCE, buildPublicationPlan } = require('../../lib/topical-map/publication-plan')

const T = (id, wave, priority, order = 0, status = 'planned') => ({
  id, title: `T${id}`, publication_wave: wave, priority_score: priority, sort_order: order, content_status: status,
})

test('CADENCES covers the four Step-22 site maturities', () => {
  assert.deepEqual(Object.keys(CADENCES).sort(), ['established', 'growing', 'mature', 'new'])
  assert.equal(CADENCES.new.perWeek, 3)
  assert.equal(CADENCES.mature.refreshesPerWeek, 2)
  assert.equal(DEFAULT_CADENCE, 'growing')
})

test('orders by wave, then priority desc, then sort_order', () => {
  const topics = [T('c', 2, 90), T('a', 1, 50, 1), T('b', 1, 50, 0), T('d', 1, 99)]
  const plan = buildPublicationPlan(topics, { perWeek: 10 })
  assert.deepEqual(plan.weeks[0].topics.map((t) => t.id), ['d', 'b', 'a', 'c'])
})

test('a missing wave sorts last (not treated as wave 1)', () => {
  const noWave = { id: 'x', priority_score: 100, content_status: 'planned' }
  const plan = buildPublicationPlan([noWave, T('a', 1, 1)], { perWeek: 10 })
  assert.deepEqual(plan.weeks[0].topics.map((t) => t.id), ['a', 'x'])
})

test('chunks into weeks at the cadence rate', () => {
  const topics = Array.from({ length: 7 }, (_, i) => T(`t${i}`, 1, 100 - i))
  const plan = buildPublicationPlan(topics, { cadence: 'established' }) // 2/week
  assert.equal(plan.cadence.perWeek, 2)
  assert.deepEqual(plan.weeks.map((w) => w.topics.length), [2, 2, 2, 1])
  assert.deepEqual(plan.weeks.map((w) => w.week), [1, 2, 3, 4])
  assert.equal(plan.total, 7)
})

test('assigns weekly target dates from startDate (UTC, 7-day steps)', () => {
  const topics = Array.from({ length: 3 }, (_, i) => T(`t${i}`, 1, 10))
  const plan = buildPublicationPlan(topics, { perWeek: 1, startDate: '2026-07-20' })
  assert.deepEqual(plan.weeks.map((w) => w.target_date), ['2026-07-20', '2026-07-27', '2026-08-03'])
  assert.equal(plan.start_date, '2026-07-20')
})

test('no startDate -> ordered weeks with null dates (never an invented date)', () => {
  const plan = buildPublicationPlan([T('a', 1, 5)], {})
  assert.equal(plan.start_date, null)
  assert.equal(plan.weeks[0].target_date, null)
  assert.equal(plan.weeks[0].week, 1)
})

test('unusable startDate degrades to null dates, not Invalid Date', () => {
  const plan = buildPublicationPlan([T('a', 1, 5)], { startDate: 'not-a-date' })
  assert.equal(plan.weeks[0].target_date, null)
})

test('published topics are excluded by default, included on request', () => {
  const topics = [T('done', 1, 90, 0, 'published'), T('todo', 1, 10)]
  assert.deepEqual(buildPublicationPlan(topics, { perWeek: 10 }).weeks[0].topics.map((t) => t.id), ['todo'])
  const withPublished = buildPublicationPlan(topics, { perWeek: 10, includePublished: true })
  assert.deepEqual(withPublished.weeks[0].topics.map((t) => t.id), ['done', 'todo'])
})

test('unknown cadence falls back to the default', () => {
  assert.equal(buildPublicationPlan([T('a', 1, 1)], { cadence: 'nonsense' }).cadence.key, 'growing')
})

test('explicit perWeek overrides the cadence rate', () => {
  const plan = buildPublicationPlan(Array.from({ length: 4 }, (_, i) => T(`t${i}`, 1, 1)), { cadence: 'mature', perWeek: 4 })
  assert.equal(plan.weeks.length, 1)
  assert.equal(plan.cadence.perWeek, 4)
})

test('empty / malformed input is safe', () => {
  for (const bad of [[], null, undefined, 'nope', [null, undefined, 3]]) {
    const plan = buildPublicationPlan(bad, {})
    assert.equal(plan.total, 0)
    assert.deepEqual(plan.weeks, [])
  }
})
