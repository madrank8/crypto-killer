import { listThreads } from '@/lib/agent-chat'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }
  try {
    const threads = await listThreads(40)
    return Response.json({ ok: true, threads: threads || [] })
  } catch (err) {
    console.error('[agent/threads]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
