import { supabaseRequest } from '@/lib/supabase'

export const maxDuration = 300

/**
 * GET /api/cron/content-maintenance — the autonomous regeneration engine.
 *
 * Runs every 15 minutes (vercel.json). Each invocation advances ONE queue
 * item ONE step, so a review takes ~3 ticks (~45 min) end to end and the
 * corpus republishes gradually (~1.3/hour) instead of in a bulk burst.
 *
 *   queued     → trigger /reviews/generate (SSE, consumed here) → generated
 *   generated  → trigger /reviews/[id]/polish (SSE)             → polished
 *   polished   → gated publish: audit_score >= 80, no hard-fail,
 *                validate-publish passes (enforced inside the publish
 *                route) → published; anything less → needs_review
 *
 * AUTONOMY POLICY (owner decision 2026-07-05): auto-publish is allowed
 * ONLY behind the full gate stack for REGENERATIONS of already-published
 * reviews. Sub-80 audits, hard-fails, or gate 422s park the item in
 * needs_review for a human — the engine never lowers a bar to keep moving.
 *
 * Recovery: SSE steps can outlive this cron's 300s budget (generate has a
 * 600s ceiling). Items left in generating/polishing are re-checked against
 * the review row's generation_status on the next tick — if the underlying
 * work finished, the item advances; if >30 min stale, the attempt counter
 * increments and the stage retries (2 attempts max → failed).
 *
 * Self-sustaining: when the queue has no actionable items, the scanner
 * auto-queues published masters that carry pre-audit debt (no
 * ai_disclosure / no category_scores) so this class of problem never
 * accumulates again. Slugs whose previous queue row finished (published/
 * failed/skipped) are requeued by PATCH, not blocked by the unique index.
 *
 * UNPARKING: needs_review is terminal FOR THE ENGINE. To requeue after a
 * human fix, set the row back manually:
 *   update regen_queue set status='queued', attempts=0, last_error=null
 *   where slug='<slug>';
 */

const AUDIT_PUBLISH_FLOOR = 80
const MAX_STAGE_ATTEMPTS = 2
const STUCK_MINUTES = 30
// The SSE budget MUST cover the full generate stage (route maxDuration=600s).
// The old 240000 (240s) aborted generate mid-run: on Vercel, aborting the
// cron's inbound-consuming fetch cancels the generate invocation before it
// PATCHes the review row, so content was never persisted, the item went
// stale, and every queue item parked as "stage 'generating' stuck twice".
// generate now runs to completion in-tick (result.done fires, row written,
// item advances same tick). Kept below the cron's own maxDuration (700s in
// vercel.json) so a genuinely-hung stage still aborts cleanly with headroom.
const SSE_BUDGET_MS = 680000

function nowIso() {
  return new Date().toISOString()
}

async function patchItem(id, patch) {
  await supabaseRequest(`/regen_queue?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: nowIso() }),
  })
}

/**
 * Consume an SSE endpoint until a terminal event, error, or budget expiry.
 * Returns { done: boolean, error: string|null, timedOut: boolean }.
 */
async function consumeSse(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SSE_BUDGET_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      return { done: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, timedOut: false }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        try {
          const evt = JSON.parse(dataLine.slice(6))
          if (evt.step === 'done') return { done: true, error: null, timedOut: false }
          if (evt.step === 'error' || evt.error === true) {
            return { done: false, error: String(evt.message || 'pipeline error').slice(0, 300), timedOut: false }
          }
        } catch { /* partial/malformed frame — keep reading */ }
      }
    }
    // Stream closed without a terminal event — treat as inconclusive.
    return { done: false, error: null, timedOut: false }
  } catch (e) {
    if (e.name === 'AbortError') return { done: false, error: null, timedOut: true }
    return { done: false, error: String(e.message).slice(0, 300), timedOut: false }
  } finally {
    clearTimeout(timer)
  }
}

async function getReview(reviewId) {
  const rows = await supabaseRequest(
    `/reviews?id=eq.${reviewId}&select=id,slug,status,generation_status,audit_hard_fail,audit_hard_fail_reason,trust_indicators,updated_at&limit=1`,
    { useServiceRole: true }
  )
  return Array.isArray(rows) ? rows[0] : null
}

/** Scanner: queue published masters that still carry pre-audit debt. */
async function scanAndQueue() {
  const rows = await supabaseRequest(
    `/reviews?status=eq.published&is_master=not.is.false&ai_disclosure=is.null&select=id,brand_id,slug&limit=10`,
    { useServiceRole: true }
  )
  let added = 0
  for (const r of rows || []) {
    try {
      // Reviewer risk #2 (2026-07-05): the unique slug index + a finished
      // previous row used to block requeueing FOREVER. Check for an
      // existing row first; terminal rows get PATCHed back to queued
      // (needs_review stays parked for a human — never auto-unparked).
      const existing = await supabaseRequest(
        `/regen_queue?slug=eq.${encodeURIComponent(r.slug)}&select=id,status&limit=1`,
        { useServiceRole: true }
      )
      if (Array.isArray(existing) && existing.length > 0) {
        if (['published', 'failed', 'skipped'].includes(existing[0].status)) {
          await patchItem(existing[0].id, {
            status: 'queued',
            attempts: 0,
            last_error: null,
            reason: 'scanner: still published without ai_disclosure after previous cycle',
          })
          added++
        }
        continue
      }
      await supabaseRequest('/regen_queue?on_conflict=slug', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify([{
          review_id: r.id,
          brand_id: r.brand_id,
          slug: r.slug,
          priority: 50,
          status: 'queued',
          reason: 'scanner: published without ai_disclosure (pre-audit vintage)',
        }]),
      })
      added++
    } catch { /* duplicate or transient — skip */ }
  }
  return added
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer' && !!process.env.CRON_SECRET && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer' && !!process.env.ADMIN_SECRET && token === process.env.ADMIN_SECRET
  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_SECRET) {
    return Response.json({ error: 'ADMIN_SECRET required for internal pipeline calls' }, { status: 500 })
  }

  const origin = new URL(request.url).origin
  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.ADMIN_SECRET}`,
  }

  try {
    // ── Pick the next actionable item (in-flight stages first, then queue order)
    const items = await supabaseRequest(
      `/regen_queue?status=in.(generating,polishing,queued,generated,polished)&select=*&order=priority.asc,queued_at.asc&limit=20`,
      { useServiceRole: true }
    )
    const inFlight = (items || []).filter((i) => ['generating', 'polishing'].includes(i.status))
    const actionable = (items || []).filter((i) => ['queued', 'generated', 'polished'].includes(i.status))
    const item = inFlight[0] || actionable[0]

    if (!item) {
      const added = await scanAndQueue()
      return Response.json({ ok: true, action: 'idle', scanner_queued: added })
    }

    const review = await getReview(item.review_id)
    if (!review) {
      await patchItem(item.id, { status: 'failed', last_error: 'review row not found' })
      return Response.json({ ok: true, action: 'failed_missing_review', slug: item.slug })
    }

    // ── Recovery for in-flight stages ────────────────────────────────
    if (item.status === 'generating' || item.status === 'polishing') {
      const wantedStatus = item.status === 'generating' ? 'content_generated' : 'polished'
      const nextQueueStatus = item.status === 'generating' ? 'generated' : 'polished'
      // Reviewer risk #1 (2026-07-05): require the review row to have been
      // WRITTEN AFTER this stage started — vintage rows can carry a stale
      // 'content_generated' from months ago, and matching on status alone
      // would false-advance a crashed generate onto old content.
      const rowChangedSinceStage =
        item.stage_started_at && review.updated_at &&
        new Date(review.updated_at) > new Date(item.stage_started_at)
      // Reviewer risk #4: generate may complete and THEN the polish-watchdog
      // flips content_generated → polish_failed before we read it. A fresh
      // write with either value means generation finished.
      const generateFinished = item.status === 'generating' &&
        ['content_generated', 'polish_failed'].includes(review.generation_status)
      const polishFinished = item.status === 'polishing' && review.generation_status === 'polished'
      if (rowChangedSinceStage && (generateFinished || polishFinished)) {
        await patchItem(item.id, { status: nextQueueStatus, last_error: null, attempts: 0 })
        return Response.json({ ok: true, action: `recovered_${nextQueueStatus}`, slug: item.slug })
      }
      void wantedStatus
      const staleMin = (Date.now() - new Date(item.stage_started_at || item.updated_at)) / 60000
      if (staleMin < STUCK_MINUTES) {
        return Response.json({ ok: true, action: 'waiting_in_flight', slug: item.slug, stage: item.status, minutes: Math.round(staleMin) })
      }
      // Stuck — retry the stage or fail out.
      if (item.attempts + 1 >= MAX_STAGE_ATTEMPTS) {
        await patchItem(item.id, { status: 'needs_review', last_error: `stage '${item.status}' stuck twice — manual look needed` })
        return Response.json({ ok: true, action: 'parked_needs_review', slug: item.slug })
      }
      await patchItem(item.id, {
        status: item.status === 'generating' ? 'queued' : 'generated',
        attempts: item.attempts + 1,
        last_error: `stage '${item.status}' stale after ${Math.round(staleMin)}min — retrying`,
      })
      return Response.json({ ok: true, action: 'retry_scheduled', slug: item.slug })
    }

    // ── queued → generate ────────────────────────────────────────────
    if (item.status === 'queued') {
      await patchItem(item.id, { status: 'generating', stage_started_at: nowIso() })
      const result = await consumeSse(`${origin}/api/admin/reviews/generate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ brand_id: item.brand_id }),
      })
      if (result.done) {
        // attempts reset on stage advance (reviewer risk #6: counter is
        // per-stage, not cumulative across the whole item)
        await patchItem(item.id, { status: 'generated', last_error: null, attempts: 0 })
        return Response.json({ ok: true, action: 'generated', slug: item.slug })
      }
      if (result.timedOut || (!result.error && !result.done)) {
        // Generation may still be running server-side — recovery path
        // checks generation_status next tick.
        return Response.json({ ok: true, action: 'generate_inconclusive', slug: item.slug })
      }
      await patchItem(item.id, {
        status: item.attempts + 1 >= MAX_STAGE_ATTEMPTS ? 'needs_review' : 'queued',
        attempts: item.attempts + 1,
        last_error: result.error,
      })
      return Response.json({ ok: true, action: 'generate_failed', slug: item.slug, error: result.error })
    }

    // ── generated → polish ───────────────────────────────────────────
    if (item.status === 'generated') {
      await patchItem(item.id, { status: 'polishing', stage_started_at: nowIso() })
      const result = await consumeSse(`${origin}/api/admin/reviews/${item.review_id}/polish`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({}),
      })
      if (result.done) {
        await patchItem(item.id, { status: 'polished', last_error: null, attempts: 0 })
        return Response.json({ ok: true, action: 'polished', slug: item.slug })
      }
      if (result.timedOut || (!result.error && !result.done)) {
        return Response.json({ ok: true, action: 'polish_inconclusive', slug: item.slug })
      }
      await patchItem(item.id, {
        status: item.attempts + 1 >= MAX_STAGE_ATTEMPTS ? 'needs_review' : 'generated',
        attempts: item.attempts + 1,
        last_error: result.error,
      })
      return Response.json({ ok: true, action: 'polish_failed', slug: item.slug, error: result.error })
    }

    // ── polished → gated publish ─────────────────────────────────────
    if (item.status === 'polished') {
      const fresh = await getReview(item.review_id)
      const auditScore = Number(fresh?.trust_indicators?.audit_score)
      if (fresh?.audit_hard_fail === true) {
        await patchItem(item.id, { status: 'needs_review', last_error: `audit VETO: ${fresh.audit_hard_fail_reason || 'hard fail'}` })
        return Response.json({ ok: true, action: 'parked_audit_veto', slug: item.slug })
      }
      if (!Number.isFinite(auditScore) || auditScore < AUDIT_PUBLISH_FLOOR) {
        await patchItem(item.id, { status: 'needs_review', last_error: `audit score ${Number.isFinite(auditScore) ? auditScore : 'missing'} below auto-publish floor (${AUDIT_PUBLISH_FLOOR})` })
        return Response.json({ ok: true, action: 'parked_low_score', slug: item.slug, score: auditScore })
      }

      const pubRes = await fetch(`${origin}/api/admin/reviews/${item.review_id}/publish`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ action: 'publish' }),
        signal: AbortSignal.timeout(120000),
      })
      const pubData = await pubRes.json().catch(() => ({}))
      if (pubRes.ok && pubData.success === true) {
        await patchItem(item.id, { status: 'published', last_error: null })
        return Response.json({ ok: true, action: 'published', slug: item.slug, score: auditScore })
      }
      await patchItem(item.id, {
        status: 'needs_review',
        last_error: `publish gate: ${JSON.stringify(pubData.errors || pubData.failures || pubData.error || pubRes.status).slice(0, 400)}`,
      })
      return Response.json({ ok: true, action: 'parked_publish_gate', slug: item.slug })
    }

    return Response.json({ ok: true, action: 'noop' })
  } catch (err) {
    console.error('[content-maintenance]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
