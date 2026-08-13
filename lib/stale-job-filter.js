'use strict'

/**
 * PostgREST filter for scraper stale-job cleanup.
 *
 * Chained scrape jobs keep one `started_at` across many 5-minute lambdas.
 * Reaping on started_at > 6 minutes killed healthy jobs around skip 37k.
 * Reap only when the heartbeat is stale. Jobs with no heartbeat (legacy
 * rows) fall back to started_at using the same 3-minute window.
 */

const HEARTBEAT_STALE_MS = 180 * 1000

function buildStaleJobFilter(now = Date.now()) {
  const heartbeatCutoff = new Date(now - HEARTBEAT_STALE_MS).toISOString()
  return (
    `status=in.("pending","running")` +
    `&or=(progress->>last_heartbeat.lt.${heartbeatCutoff},and(progress->>last_heartbeat.is.null,started_at.lt.${heartbeatCutoff}))`
  )
}

module.exports = {
  HEARTBEAT_STALE_MS,
  buildStaleJobFilter,
}
