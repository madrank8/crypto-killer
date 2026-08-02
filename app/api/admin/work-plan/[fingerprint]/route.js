import { updateWorkItem } from '@/lib/work-plan'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const ALLOWED = new Set(['queued', 'running', 'blocked', 'done', 'dismissed'])

export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }
  try {
    const { fingerprint } = await params
    const body = await request.json()
    const patch = {}
    if (body.status) {
      if (!ALLOWED.has(body.status)) {
        return Response.json({ error: 'invalid status' }, { status: 400 })
      }
      patch.status = body.status
      if (body.status === 'done') patch.executed_at = new Date().toISOString()
    }
    if (body.last_error !== undefined) patch.last_error = body.last_error
    if (body.priority && ['P0', 'P1', 'P2'].includes(body.priority)) patch.priority = body.priority
    if (Object.keys(patch).length === 0) {
      return Response.json({ error: 'no valid fields' }, { status: 400 })
    }
    const result = await updateWorkItem(decodeURIComponent(fingerprint), patch)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('[work-plan PATCH]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
