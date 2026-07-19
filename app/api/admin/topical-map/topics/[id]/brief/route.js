import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { buildContentBrief } from '@/lib/topical-map/content-brief'

/**
 * GET /api/admin/topical-map/topics/[id]/brief
 *
 * Returns the deterministic content brief for a topic — the same projection the
 * outline generator injects into its prompt (buildContentBrief), so the dashboard
 * shows exactly what a topic will hand the writer before generation. Read-only;
 * fabricates nothing (empty fields are omitted by buildContentBrief).
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const topicRows = await supaFetch(`/topics?id=eq.${id}&select=*&limit=1`)
    const topic = Array.isArray(topicRows) ? topicRows[0] : null
    if (!topic) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    let parentTopic = null
    if (topic.parent_id) {
      const parentRows = await supaFetch(`/topics?id=eq.${topic.parent_id}&select=id,title,target_keyword,content_type&limit=1`)
      parentTopic = Array.isArray(parentRows) ? parentRows[0] : null
    }

    const brief = buildContentBrief(topic, { parentTopic })
    return Response.json({ brief })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
