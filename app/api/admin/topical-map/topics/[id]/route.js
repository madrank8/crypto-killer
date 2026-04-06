import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * PATCH /api/admin/topical-map/topics/[id]
 * Body: partial topic fields (title, target_keyword, priority_score, notes, etc.)
 */
export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const updates = await request.json()
    if (!updates || typeof updates !== 'object') {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    delete updates.id
    delete updates.map_id
    updates.updated_at = new Date().toISOString()

    await supaFetch(`/topics?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(updates),
    })

    return Response.json({ ok: true })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/topical-map/topics/[id]?cascade=true|false
 * - cascade=true: delete topic and all descendants
 * - cascade=false: delete only this topic (children become root-level via ON DELETE SET NULL)
 */
export async function DELETE(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const cascade = searchParams.get('cascade') === 'true'

    const topicRows = await supaFetch(`/topics?id=eq.${id}&select=id,map_id,title&limit=1`)
    const topic = Array.isArray(topicRows) ? topicRows[0] : null
    if (!topic) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    let idsToDelete = [id]

    if (cascade) {
      const allRows = await supaFetch(`/topics?map_id=eq.${topic.map_id}&select=id,parent_id`)
      const all = Array.isArray(allRows) ? allRows : []
      const childrenByParent = new Map()
      for (const row of all) {
        const key = row.parent_id || 'root'
        if (!childrenByParent.has(key)) childrenByParent.set(key, [])
        childrenByParent.get(key).push(row.id)
      }

      const stack = [id]
      const seen = new Set([id])
      while (stack.length > 0) {
        const curr = stack.pop()
        const kids = childrenByParent.get(curr) || []
        for (const kid of kids) {
          if (!seen.has(kid)) {
            seen.add(kid)
            stack.push(kid)
          }
        }
      }
      idsToDelete = Array.from(seen)
    }

    if (idsToDelete.length === 1) {
      await supaFetch(`/topics?id=eq.${id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
    } else {
      await supaFetch(`/topics?id=in.(${idsToDelete.join(',')})`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
    }

    return Response.json({ ok: true, deleted_count: idsToDelete.length })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
