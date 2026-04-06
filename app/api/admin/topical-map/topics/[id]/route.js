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
