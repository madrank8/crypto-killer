import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { runReviewQualityFix } from '@/lib/quality-fix-review'

export const maxDuration = 300

/**
 * POST /api/admin/reviews/[id]/quality-fix
 *
 * SSE: one Quality Fix Agent cycle for a brand-review row.
 * Body: { auto_publish?: boolean } (default true).
 * Publish (when ready) calls the existing publish route with { action: 'publish' }
 * only — never override.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return Response.json({ error: 'Invalid review id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const autoPublish = body.auto_publish !== false
    const authorization = request.headers.get('authorization')
    const origin = new URL(request.url).origin

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }
        try {
          send({ step: 'init', status: 'active' })
          const result = await runReviewQualityFix(id, {
            authorization,
            send,
            autoPublish,
            origin,
          })
          send({
            step: result.published ? 'done' : 'needs_review',
            status: 'done',
            ok: result.ok,
            ready: result.ready,
            published: result.published,
            applied: result.applied,
            unfixable: result.unfixable,
            audit_summary: result.audit_summary,
            reasons: result.reasons,
            quality_fix: result.quality_fix,
            human_only: Boolean(result.human_only || (!result.ready && !result.published)),
          })
        } catch (e) {
          send({
            step: 'error',
            status: 'failed',
            message: e?.message || String(e),
          })
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
