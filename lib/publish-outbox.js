/**
 * Durable publish → live-site sync outbox.
 *
 * Publish routes flip Supabase first, then enqueue here. A cron worker
 * (/api/cron/publish-outbox) claims due rows and delivers via lib/live-sync.js.
 * Immediate best-effort delivery in the publish route still runs for snappy
 * UX; failures leave the row pending for the worker.
 */

import { supaFetch } from '@/lib/supabase'
import { deliverContentToLive, deliverReviewToLive } from '@/lib/live-sync'

/** Backoff schedule in minutes after each failed attempt (1-indexed). */
export const OUTBOX_BACKOFF_MINUTES = [1, 2, 5, 15, 30, 60, 120, 360]

export function nextAttemptAt(attempts, now = new Date()) {
  const idx = Math.max(0, Math.min(attempts - 1, OUTBOX_BACKOFF_MINUTES.length - 1))
  const mins = OUTBOX_BACKOFF_MINUTES[idx]
  return new Date(now.getTime() + mins * 60 * 1000).toISOString()
}

/**
 * Enqueue a sync job. Supersedes older non-terminal jobs for the same
 * kind+entity so republish doesn't stack duplicate deliveries.
 */
export async function enqueuePublishOutbox({
  kind,
  entityId,
  slug = null,
  action,
  payload = null,
  maxAttempts = 8,
}) {
  if (!kind || !entityId || !action) {
    throw new Error('enqueuePublishOutbox requires kind, entityId, action')
  }

  const nowIso = new Date().toISOString()

  try {
    await supaFetch(
      `/publish_outbox?kind=eq.${kind}&entity_id=eq.${entityId}&status=in.(pending,failed,processing)`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'dead',
          last_error: `superseded by new ${action} at ${nowIso}`,
          updated_at: nowIso,
        }),
      },
    )
  } catch (e) {
    console.warn('[publish-outbox] supersede prior jobs failed (non-fatal):', e.message)
  }

  const rows = await supaFetch('/publish_outbox', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      kind,
      entity_id: entityId,
      slug,
      action,
      status: 'pending',
      attempts: 0,
      max_attempts: maxAttempts,
      next_attempt_at: nowIso,
      payload,
      created_at: nowIso,
      updated_at: nowIso,
    }),
  })

  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row?.id) throw new Error('publish_outbox insert returned no row')
  return row
}

export async function markOutboxSucceeded(id) {
  const nowIso = new Date().toISOString()
  await supaFetch(`/publish_outbox?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'succeeded',
      succeeded_at: nowIso,
      last_error: null,
      updated_at: nowIso,
    }),
  })
}

export async function markOutboxRetry(id, { attempts, maxAttempts, error }) {
  const nowIso = new Date().toISOString()
  const dead = attempts >= maxAttempts
  await supaFetch(`/publish_outbox?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: dead ? 'dead' : 'pending',
      attempts,
      last_error: String(error || 'unknown').slice(0, 1000),
      last_attempt_at: nowIso,
      next_attempt_at: dead ? nowIso : nextAttemptAt(attempts),
      updated_at: nowIso,
    }),
  })
  return { dead }
}

/**
 * Claim due rows (pending/failed with next_attempt_at <= now).
 * Optimistic claim: patch to processing only if still pending/failed.
 */
export async function claimDueOutboxJobs(limit = 5) {
  const nowIso = new Date().toISOString()
  const due = await supaFetch(
    `/publish_outbox?status=in.(pending,failed)&next_attempt_at=lte.${encodeURIComponent(nowIso)}` +
      `&order=created_at.asc&limit=${limit}`,
    { useServiceRole: true },
  )
  const rows = Array.isArray(due) ? due : []
  const claimed = []

  for (const row of rows) {
    try {
      const updated = await supaFetch(
        `/publish_outbox?id=eq.${row.id}&status=in.(pending,failed)`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            status: 'processing',
            last_attempt_at: nowIso,
            updated_at: nowIso,
          }),
        },
      )
      const claimedRow = Array.isArray(updated) ? updated[0] : updated
      if (claimedRow?.id) claimed.push(claimedRow)
    } catch (e) {
      console.warn('[publish-outbox] claim race skipped:', row.id, e.message)
    }
  }

  return claimed
}

/**
 * Deliver one outbox job and update its status.
 * Returns { success, result, dead }.
 */
export async function processOutboxJob(job) {
  const attempts = Number(job.attempts || 0) + 1
  const maxAttempts = Number(job.max_attempts || 8)

  let result
  try {
    if (job.kind === 'content') {
      result = await deliverContentToLive(job.entity_id, job.action)
    } else if (job.kind === 'review') {
      result = await deliverReviewToLive(job.entity_id, job.action)
    } else {
      result = { success: false, error: `unknown kind: ${job.kind}` }
    }
  } catch (e) {
    result = { success: false, error: e.message }
  }

  if (result?.success) {
    await markOutboxSucceeded(job.id)
    return { success: true, result, dead: false }
  }

  const { dead } = await markOutboxRetry(job.id, {
    attempts,
    maxAttempts,
    error: result?.error || result?.message || 'delivery failed',
  })
  return { success: false, result, dead }
}

/**
 * Best-effort immediate delivery after enqueue.
 * On success marks the outbox row succeeded; on failure leaves it for cron.
 */
export async function tryImmediateOutboxDelivery(job) {
  if (!job?.id) return { success: false, error: 'no outbox job' }

  let result
  try {
    if (job.kind === 'content') {
      result = await deliverContentToLive(job.entity_id, job.action)
    } else {
      result = await deliverReviewToLive(job.entity_id, job.action)
    }
  } catch (e) {
    result = { success: false, error: e.message }
  }

  if (result?.success) {
    try {
      await markOutboxSucceeded(job.id)
    } catch (e) {
      console.warn('[publish-outbox] mark succeeded failed:', e.message)
    }
    return result
  }

  try {
    await markOutboxRetry(job.id, {
      attempts: 1,
      maxAttempts: Number(job.max_attempts || 8),
      error: result?.error || 'immediate delivery failed',
    })
  } catch (e) {
    console.warn('[publish-outbox] schedule retry failed:', e.message)
  }

  return result
}

export async function drainPublishOutbox({ limit = 5 } = {}) {
  const claimed = await claimDueOutboxJobs(limit)
  const results = []
  for (const job of claimed) {
    const outcome = await processOutboxJob(job)
    results.push({
      id: job.id,
      kind: job.kind,
      entity_id: job.entity_id,
      slug: job.slug,
      action: job.action,
      ...outcome,
    })
  }
  return { claimed: claimed.length, results }
}
