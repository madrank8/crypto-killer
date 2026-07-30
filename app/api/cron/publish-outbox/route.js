import { drainPublishOutbox } from '@/lib/publish-outbox'

/**
 * GET /api/cron/publish-outbox
 *
 * Drains durable Replit sync jobs enqueued by content/review publish routes.
 * Retries with exponential backoff until max_attempts, then marks dead.
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron) or ADMIN_SECRET (manual).
 */

export const maxDuration = 60

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer'
    && !!process.env.CRON_SECRET
    && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer'
    && !!process.env.ADMIN_SECRET
    && token === process.env.ADMIN_SECRET

  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 5)))
    const drained = await drainPublishOutbox({ limit })
    const succeeded = drained.results.filter((r) => r.success).length
    const failed = drained.results.filter((r) => !r.success).length
    const dead = drained.results.filter((r) => r.dead).length

    return Response.json({
      ok: true,
      claimed: drained.claimed,
      succeeded,
      failed,
      dead,
      results: drained.results.map((r) => ({
        id: r.id,
        kind: r.kind,
        entity_id: r.entity_id,
        slug: r.slug,
        action: r.action,
        success: r.success,
        dead: r.dead,
        error: r.result?.error || null,
      })),
    })
  } catch (error) {
    console.error('[cron/publish-outbox]', error)
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
}
