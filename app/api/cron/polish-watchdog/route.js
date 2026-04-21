import { supaFetch } from '@/lib/supabase'

/**
 * GET /api/cron/polish-watchdog
 *
 * Detects reviews that have been stuck in phase-B generation states for too
 * long and marks them as failed so the admin UI shows the "Retry Polish"
 * banner and stops believing work is in flight.
 *
 * Two stuck states we recover from:
 *
 *   1. generation_status = 'polishing' for > 10 minutes
 *      Polish started (set status, wrote polish_error=null), but died before
 *      reaching the final catch block. Usually a Vercel timeout, client
 *      disconnect, or cold-start hang. The review will sit forever without
 *      this sweep because the catch that writes polish_failed only runs
 *      inside the SSE stream lifecycle.
 *
 *   2. generation_status = 'content_generated' AND updated_at > 30 minutes ago
 *      Phase A completed (draft saved) but the editor auto-polish never ran
 *      — typically because the tab that triggered /generate was closed
 *      before the editor mounted the useEffect that auto-fires /polish.
 *      30 min is conservative; a normal polish settles in 60-120s, so anything
 *      past 30 min is definitely abandoned.
 *
 * Both get flipped to generation_status='polish_failed' with a descriptive
 * polish_error so the existing retry banner at app/admin/review/[id]/page.js
 * surfaces them. The author clicks "Retry Polish" and the normal SSE flow
 * picks up from scratch.
 *
 * Idempotent — safe to re-run. Scoped to reviews only; blog-posts content
 * has its own lifecycle on the Vercel admin side and doesn't need this.
 *
 * Auth: Vercel Cron invocations include x-vercel-cron: 1. For manual runs,
 * pass Authorization: Bearer ADMIN_SECRET.
 */

const POLISHING_STUCK_MINUTES = 10
const CONTENT_GENERATED_STUCK_MINUTES = 30

export const maxDuration = 30

export async function GET(request) {
  // Accept Vercel Cron OR admin bearer token — both legitimate callers.
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isAdmin = scheme === 'Bearer' && token === process.env.ADMIN_SECRET

  if (!isVercelCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const polishingCutoff = new Date(now.getTime() - POLISHING_STUCK_MINUTES * 60_000).toISOString()
    const contentGeneratedCutoff = new Date(now.getTime() - CONTENT_GENERATED_STUCK_MINUTES * 60_000).toISOString()

    // Find stuck 'polishing' rows
    const stuckPolishing = await supaFetch(
      `/reviews?generation_status=eq.polishing&updated_at=lt.${encodeURIComponent(polishingCutoff)}&select=id,slug,updated_at`
    )

    // Find stuck 'content_generated' rows (orphaned phase-A output)
    const stuckContentGenerated = await supaFetch(
      `/reviews?generation_status=eq.content_generated&updated_at=lt.${encodeURIComponent(contentGeneratedCutoff)}&select=id,slug,updated_at`
    )

    const patched = {
      polishing_recovered: 0,
      content_generated_recovered: 0,
      ids: [],
    }

    // Reset stuck polishing
    for (const row of stuckPolishing || []) {
      const stuckFor = Math.round((now.getTime() - new Date(row.updated_at).getTime()) / 60_000)
      await supaFetch(`/reviews?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          generation_status: 'polish_failed',
          polish_error: `Watchdog: polish was in-flight for ${stuckFor} minutes without completing (likely Vercel timeout or client disconnect). Click Retry Polish to run phase B again.`,
          updated_at: new Date().toISOString(),
        }),
        headers: { 'Prefer': 'return=minimal' },
      })
      patched.polishing_recovered++
      patched.ids.push({ id: row.id, slug: row.slug, state: 'polishing', stuck_for_min: stuckFor })
    }

    // Reset stuck content_generated — phase B never started
    for (const row of stuckContentGenerated || []) {
      const stuckFor = Math.round((now.getTime() - new Date(row.updated_at).getTime()) / 60_000)
      await supaFetch(`/reviews?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          generation_status: 'polish_failed',
          polish_error: `Watchdog: draft sat in content_generated for ${stuckFor} minutes without the editor auto-polish firing (tab probably closed before phase B began). Click Retry Polish to run phase B.`,
          updated_at: new Date().toISOString(),
        }),
        headers: { 'Prefer': 'return=minimal' },
      })
      patched.content_generated_recovered++
      patched.ids.push({ id: row.id, slug: row.slug, state: 'content_generated', stuck_for_min: stuckFor })
    }

    return Response.json({
      success: true,
      scanned_at: now.toISOString(),
      thresholds_min: {
        polishing: POLISHING_STUCK_MINUTES,
        content_generated: CONTENT_GENERATED_STUCK_MINUTES,
      },
      ...patched,
    })
  } catch (error) {
    console.error('[polish-watchdog] error:', error)
    return Response.json(
      { error: error.message || 'Watchdog failed' },
      { status: 500 }
    )
  }
}
