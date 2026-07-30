'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  SYNC_RUN_STATUSES,
  statusTone,
  summarizeSyncRuns,
  isFinishedOk,
  buildReliabilityMetrics,
} = require('../lib/sync-runs-status')

test('statusTone maps canonical statuses', () => {
  assert.equal(statusTone('pending'), 'active')
  assert.equal(statusTone('running'), 'active')
  assert.equal(statusTone('completed'), 'success')
  assert.equal(statusTone('completed_with_errors'), 'warning')
  assert.equal(statusTone('failed'), 'failed')
  assert.equal(statusTone('complete'), 'unknown')
  assert.equal(statusTone('success'), 'unknown')
})

test('summarizeSyncRuns buckets five statuses', () => {
  const runs = [
    { status: 'completed', started_at: '2026-07-01T00:00:00Z', finished_at: '2026-07-01T00:10:00Z', creatives_synced: 10, brands_updated: 2 },
    { status: 'completed_with_errors', started_at: '2026-07-02T00:00:00Z', finished_at: '2026-07-02T00:05:00Z', creatives_synced: 5, brands_updated: 1 },
    { status: 'failed', started_at: '2026-07-03T00:00:00Z', finished_at: '2026-07-03T00:01:00Z' },
    { status: 'running' },
    { status: 'pending' },
  ]
  const s = summarizeSyncRuns(runs)
  assert.equal(s.total_runs, 5)
  assert.equal(s.completed, 1)
  assert.equal(s.completed_with_errors, 1)
  assert.equal(s.failed, 1)
  assert.equal(s.total_creatives_synced, 15)
  assert.equal(s.total_brands_updated, 3)
  // avg over finished-ok only: 600s + 300s = 450
  assert.equal(s.avg_duration_seconds, 450)
})

test('completed_with_errors counts as finished-ok for freshness', () => {
  assert.equal(isFinishedOk('completed'), true)
  assert.equal(isFinishedOk('completed_with_errors'), true)
  assert.equal(isFinishedOk('failed'), false)
  assert.equal(isFinishedOk('running'), false)
})

test('buildReliabilityMetrics rates and cron miss', () => {
  const now = new Date('2026-07-30T12:00:00Z')
  const runs = [
    {
      id: 'a',
      status: 'completed',
      started_at: '2026-07-30T00:00:00Z',
      finished_at: '2026-07-30T00:20:00Z',
      new_creatives: 100,
    },
    {
      id: 'b',
      status: 'completed_with_errors',
      started_at: '2026-07-29T00:00:00Z',
      finished_at: '2026-07-29T00:15:00Z',
      new_creatives: 50,
      error_message: 'brand rebuild partial',
    },
    {
      id: 'c',
      status: 'failed',
      started_at: '2026-07-28T00:00:00Z',
      finished_at: '2026-07-28T00:05:00Z',
      error_message: 'cookie expired',
      progress: { next_skip: 30000 },
    },
  ]

  const m = buildReliabilityMetrics(runs, { now, windowDays: 30, cronMissHours: 25 })
  assert.equal(m.summary.completed, 1)
  assert.equal(m.summary.completed_with_errors, 1)
  assert.equal(m.summary.failed, 1)
  assert.equal(m.completion_rate, 1 / 3)
  assert.equal(m.warning_rate, 1 / 3)
  assert.equal(m.failure_rate, 1 / 3)
  assert.equal(m.cron_miss, false)
  assert.equal(m.last_finished.status, 'completed')
  assert.equal(m.recent_failures.length, 1)
  assert.equal(m.recent_failures[0].next_skip, 30000)
  assert.ok(m.throughput.length >= 1)
})

test('buildReliabilityMetrics flags cron miss when stale', () => {
  const now = new Date('2026-07-30T12:00:00Z')
  const runs = [
    {
      id: 'old',
      status: 'completed',
      started_at: '2026-07-28T00:00:00Z',
      finished_at: '2026-07-28T00:10:00Z',
      new_creatives: 1,
    },
  ]
  const m = buildReliabilityMetrics(runs, { now, cronMissHours: 25 })
  assert.equal(m.cron_miss, true)
  assert.ok(m.hours_since_last_success > 25)
})

test('SYNC_RUN_STATUSES is the only valid set', () => {
  assert.deepEqual(Object.values(SYNC_RUN_STATUSES).sort(), [
    'completed',
    'completed_with_errors',
    'failed',
    'pending',
    'running',
  ].sort())
})
