import { getThread } from '@/lib/agent-chat'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }
  try {
    const { id } = await params
    const data = await getThread(id)
    if (!data) return Response.json({ error: 'not found' }, { status: 404 })
    return Response.json({ ok: true, ...data })
  } catch (err) {
    console.error('[agent/threads/id]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
