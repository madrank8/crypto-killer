import { runAgentChat } from '@/lib/agent-chat'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export const maxDuration = 120

/**
 * POST /api/admin/agent/chat
 * Body: { message, thread_id?, days? }
 * Read/recommend only — never publishes.
 */
export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const body = await request.json()
    const result = await runAgentChat({
      threadId: body.thread_id || null,
      message: body.message,
      days: Math.min(Math.max(parseInt(body.days, 10) || 28, 7), 90),
    })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('[agent/chat]', err)
    const status = err.status || 500
    return Response.json({ error: err.message }, { status })
  }
}
