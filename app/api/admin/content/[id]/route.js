import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/content/[id]
 * Fetch content row + linked topic intel
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params

    const rows = await supaFetch(`/content?id=eq.${id}&select=*&limit=1`)
    const content = Array.isArray(rows) ? rows[0] : null
    if (!content) return Response.json({ error: 'Content not found' }, { status: 404 })

    let topic = null
    let contentBrief = null
    if (content.topic_id) {
      const topicRows = await supaFetch(`/topics?id=eq.${content.topic_id}&select=*&limit=1`)
      topic = Array.isArray(topicRows) ? topicRows[0] : null
      try {
        const briefRows = await supaFetch(
          `/content_briefs?topic_id=eq.${content.topic_id}&select=id,sullivan_ok,content_type,status,brief_id&limit=1`,
        )
        contentBrief = Array.isArray(briefRows) ? briefRows[0] : null
      } catch {
        contentBrief = null
      }
    }

    return Response.json({
      ...content,
      topic,
      content_brief: contentBrief
        ? {
            id: contentBrief.id,
            brief_id: contentBrief.brief_id,
            sullivan_ok: !!contentBrief.sullivan_ok,
            // Sullivan SC-098 — not topics.content_type
            sullivan_content_type: contentBrief.content_type || null,
            status: contentBrief.status || null,
          }
        : null,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/content/[id]
 * Update content draft fields
 */
export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    const updates = await request.json()

    if (!updates || typeof updates !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (updates.full_article) {
      updates.word_count = String(updates.full_article)
        .replace(/<[^>]*>/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length
    }

    updates.updated_at = new Date().toISOString()

    await supaFetch(`/content?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(updates),
    })

    return Response.json({ success: true, id })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

