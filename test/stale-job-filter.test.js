'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  HEARTBEAT_STALE_MS,
  buildStaleJobFilter,
} = require('../lib/stale-job-filter')

test('heartbeat stale window is 3 minutes, not 6', () => {
  assert.equal(HEARTBEAT_STALE_MS, 180 * 1000)
})

test('reaps on stale heartbeat, not on long-running started_at', () => {
  const now = Date.parse('2026-08-13T10:00:00.000Z')
  const filter = buildStaleJobFilter(now)
  const sixMinAgo = new Date(now - 6 * 60 * 1000).toISOString()
  const threeMinAgo = new Date(now - HEARTBEAT_STALE_MS).toISOString()

  assert.match(filter, /^status=in\.\("pending","running"\)/)
  assert.match(filter, new RegExp(`progress->>last_heartbeat.lt.${threeMinAgo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.doesNotMatch(
    filter,
    new RegExp(`started_at.lt.${sixMinAgo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    'must not reap every job whose started_at is older than 6 minutes — chained lambdas share one started_at',
  )
})

test('jobs with no heartbeat fall back to started_at using the heartbeat window', () => {
  const now = Date.parse('2026-08-13T10:00:00.000Z')
  const filter = buildStaleJobFilter(now)
  const threeMinAgo = new Date(now - HEARTBEAT_STALE_MS).toISOString()
  assert.match(
    filter,
    new RegExp(`and\\(progress->>last_heartbeat.is.null,started_at.lt.${threeMinAgo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`),
  )
})
