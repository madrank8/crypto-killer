'use strict'

/**
 * Canonical sync_runs status contract for scraper analytics.
 * Only these statuses are written to the table.
 */
const SYNC_RUN_STATUSES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
})

const VALID_STATUSES = Object.freeze(Object.values(SYNC_RUN_STATUSES))

/** Entry-point source persisted on create (not the same as trigger_type). */
const SYNC_RUN_SOURCES = Object.freeze({
  ADMIN: 'admin',
  CRON: 'cron',
  WEBHOOK: 'webhook',
})

function isActiveStatus(status) {
  return status === SYNC_RUN_STATUSES.PENDING || status === SYNC_RUN_STATUSES.RUNNING
}

function isFinishedOk(status) {
  return (
    status === SYNC_RUN_STATUSES.COMPLETED ||
    status === SYNC_RUN_STATUSES.COMPLETED_WITH_ERRORS
  )
}

function isWarningStatus(status) {
  return status === SYNC_RUN_STATUSES.COMPLETED_WITH_ERRORS
}

function isFailedStatus(status) {
  return status === SYNC_RUN_STATUSES.FAILED
}

/**
 * UI tone for a sync_runs status. Phantom strings (complete/success) map to unknown → fail-ish.
 * @returns {'active'|'success'|'warning'|'failed'|'unknown'}
 */
function statusTone(status) {
  if (isActiveStatus(status)) return 'active'
  if (status === SYNC_RUN_STATUSES.COMPLETED) return 'success'
  if (isWarningStatus(status)) return 'warning'
  if (isFailedStatus(status)) return 'failed'
  return 'unknown'
}

/**
 * Summarize a page of sync_runs (same window the history API returns).
 * Duration averages over finished-ok runs that have both timestamps.
 */
function summarizeSyncRuns(runs = []) {
  const list = Array.isArray(runs) ? runs : []
  const completed = list.filter((r) => r.status === SYNC_RUN_STATUSES.COMPLETED)
  const withErrors = list.filter((r) => r.status === SYNC_RUN_STATUSES.COMPLETED_WITH_ERRORS)
  const failed = list.filter((r) => r.status === SYNC_RUN_STATUSES.FAILED)
  const finishedOk = [...completed, ...withErrors]

  const durationSamples = finishedOk
    .filter((r) => r.started_at && r.finished_at)
    .map((r) => (new Date(r.finished_at) - new Date(r.started_at)) / 1000)
    .filter((s) => Number.isFinite(s) && s >= 0)

  const avgDuration =
    durationSamples.length > 0
      ? Math.round(durationSamples.reduce((a, b) => a + b, 0) / durationSamples.length)
      : 0

  return {
    total_runs: list.length,
    completed: completed.length,
    completed_with_errors: withErrors.length,
    failed: failed.length,
    total_creatives_synced: finishedOk.reduce((s, r) => s + (r.creatives_synced || 0), 0),
    total_brands_updated: finishedOk.reduce((s, r) => s + (r.brands_updated || 0), 0),
    avg_duration_seconds: avgDuration,
  }
}

function runDurationSec(run) {
  if (!run?.started_at || !run?.finished_at) return null
  const sec = Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000)
  return Number.isFinite(sec) && sec >= 0 ? sec : null
}

/**
 * Reliability KPIs from a list of sync_runs (prefer last ~30d / limit 100).
 * Cron expected at midnight UTC; miss if no finished-ok run in last cronMissHours.
 */
function buildReliabilityMetrics(runs = [], opts = {}) {
  const cronMissHours = opts.cronMissHours ?? 25
  const now = opts.now ? new Date(opts.now) : new Date()
  const list = Array.isArray(runs) ? runs : []

  const windowMs = (opts.windowDays ?? 30) * 86400000
  const windowStart = now.getTime() - windowMs
  const inWindow = list.filter((r) => {
    const t = r.started_at ? new Date(r.started_at).getTime() : 0
    return t >= windowStart
  })

  const summary = summarizeSyncRuns(inWindow)
  const finishedOk = inWindow.filter((r) => isFinishedOk(r.status))
  const failed = inWindow.filter((r) => isFailedStatus(r.status))
  const decided = summary.completed + summary.completed_with_errors + summary.failed
  const completionRate = decided > 0 ? summary.completed / decided : null
  const warningRate = decided > 0 ? summary.completed_with_errors / decided : null
  const failureRate = decided > 0 ? summary.failed / decided : null

  const finishedAll = list
    .filter((r) => r.finished_at && (isFinishedOk(r.status) || isFailedStatus(r.status)))
    .slice()
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at))

  const lastFinished = finishedAll[0] || null
  const lastSuccess = finishedAll.find((r) => isFinishedOk(r.status)) || null

  const hoursSinceLastSuccess = lastSuccess?.finished_at
    ? (now.getTime() - new Date(lastSuccess.finished_at).getTime()) / 3600000
    : null

  const cronMiss =
    hoursSinceLastSuccess == null || hoursSinceLastSuccess > cronMissHours

  const recentFinished = finishedOk
    .filter((r) => r.finished_at)
    .slice()
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at))
    .slice(0, 14)

  const durationTrend = recentFinished.map((r) => ({
    id: r.id,
    finished_at: r.finished_at,
    duration_sec: runDurationSec(r),
    status: r.status,
    new_creatives: r.new_creatives || 0,
  }))

  const throughput = recentFinished
    .map((r) => {
      const dur = runDurationSec(r)
      if (!dur || dur <= 0) return null
      return {
        id: r.id,
        finished_at: r.finished_at,
        creatives_per_min: Math.round(((r.new_creatives || 0) / dur) * 60 * 10) / 10,
        new_creatives: r.new_creatives || 0,
        duration_sec: dur,
      }
    })
    .filter(Boolean)

  const recentFailures = list
    .filter((r) => isFailedStatus(r.status))
    .slice()
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      started_at: r.started_at,
      finished_at: r.finished_at,
      error_message: r.error_message || null,
      duration_sec: runDurationSec(r),
      next_skip: r.progress?.next_skip ?? null,
      trigger_type: r.trigger_type || null,
      source: r.source || null,
    }))

  // Next midnight UTC after now
  const nextCron = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + (now.getUTCHours() === 0 && now.getUTCMinutes() === 0 ? 0 : 1),
    0, 0, 0, 0,
  ))
  if (nextCron.getTime() <= now.getTime()) {
    nextCron.setUTCDate(nextCron.getUTCDate() + 1)
  }

  return {
    window_days: opts.windowDays ?? 30,
    summary,
    completion_rate: completionRate,
    warning_rate: warningRate,
    failure_rate: failureRate,
    last_finished: lastFinished
      ? {
          id: lastFinished.id,
          status: lastFinished.status,
          finished_at: lastFinished.finished_at,
          error_message: lastFinished.error_message || null,
        }
      : null,
    last_success: lastSuccess
      ? {
          id: lastSuccess.id,
          status: lastSuccess.status,
          finished_at: lastSuccess.finished_at,
        }
      : null,
    hours_since_last_success:
      hoursSinceLastSuccess == null ? null : Math.round(hoursSinceLastSuccess * 10) / 10,
    cron_miss: cronMiss,
    cron_miss_hours: cronMissHours,
    next_scheduled_at: nextCron.toISOString(),
    avg_duration_seconds: summary.avg_duration_seconds,
    duration_trend: durationTrend,
    throughput,
    recent_failures: recentFailures,
  }
}

module.exports = {
  SYNC_RUN_STATUSES,
  VALID_STATUSES,
  SYNC_RUN_SOURCES,
  isActiveStatus,
  isFinishedOk,
  isWarningStatus,
  isFailedStatus,
  statusTone,
  summarizeSyncRuns,
  runDurationSec,
  buildReliabilityMetrics,
}
