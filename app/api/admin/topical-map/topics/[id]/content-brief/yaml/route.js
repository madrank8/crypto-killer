import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { toYaml } from '@/lib/content-brief/yaml'

/**
 * GET /api/admin/topical-map/topics/[id]/content-brief/yaml
 *
 * The handoff artifact: the brief in the canonical YAML shape seo-blog-generator
 * parses. Served as a download so it can go straight into the writing pipeline.
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const rows = await supaFetch(`/content_briefs?topic_id=eq.${id}&select=brief,brief_id&limit=1`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row?.brief) {
      return Response.json({ error: 'No assembled brief for this topic yet.' }, { status: 404 })
    }

    const filename = `${row.brief_id || 'content-brief'}.yaml`
    return new Response(toYaml(row.brief), {
      status: 200,
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
