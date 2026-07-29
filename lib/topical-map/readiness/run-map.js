'use strict'

/**
 * Stub until Task 7 lands the real orchestrator (stack gather + Firecrawl +
 * Sullivan gate + content_briefs upsert). Kept as a no-op so the import
 * route can fire-and-forget readiness without depending on unfinished work.
 */
async function startMapReadiness(_args) {
  return { started: true, stub: true }
}

module.exports = { startMapReadiness }
