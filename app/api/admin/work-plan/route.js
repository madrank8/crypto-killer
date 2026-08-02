import { listWorkPlan, enqueueWorkItem } from '@/lib/work-plan'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import crypto from 'crypto'

export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }
  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || null
    const items = await listWorkPlan({ status, limit: 80 })
    return Response.json({ ok: true, items })
  } catch (err) {
    console.error('[work-plan GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }
  try {
    const body = await request.json()
    const title = String(body.title || '').trim()
    if (!title) return Response.json({ error: 'title required' }, { status: 400 })
    const action_type = body.action_type || 'other'
    const target = body.target || null
    const fingerprint =
      body.fingerprint ||
      `chat:${action_type}:${target || title}`.slice(0, 180) +
        ':' +
        crypto.createHash('sha1').update(title + String(Date.now())).digest('hex').slice(0, 8)
    const item = await enqueueWorkItem({
      fingerprint,
      action_type,
      target,
      title,
      why: body.why || null,
      priority: body.priority || 'P2',
      deep_link: body.deep_link || null,
    })
    return Response.json({ ok: true, item })
  } catch (err) {
    console.error('[work-plan POST]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
