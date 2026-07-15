import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/content/list
 * Flat list of every content (blog/article) row for the admin.
 *
 * Closes the discoverability gap: free-form articles created not attached to a
 * topical map had NO admin entry point — reachable only by direct URL. This
 * lists them all so /admin/content is a real index.
 */
async function fetchAllContent(pageSize = 1000) {
  const rows = []
  let offset = 0
  while (true) {
    const data = await supabaseRequest(
      `/content?select=id,title,headline,slug,status,content_type,word_count,topic_id,updated_at,published_at&order=updated_at.desc&limit=${pageSize}&offset=${offset}`
    )
    if (!Array.isArray(data) || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

export async function GET(request) {
  try {
    verifyAdmin(request)
    const rows = await fetchAllContent()
    const items = rows.map((r) => ({
      id: r.id,
      title: r.title || r.headline || '(untitled)',
      slug: r.slug || '',
      status: r.status || 'draft',
      content_type: r.content_type || null,
      word_count: Number(r.word_count) || 0,
      topic_id: r.topic_id || null,
      updated_at: r.updated_at,
      published_at: r.published_at,
    }))
    const published = items.filter((r) => r.status === 'published')
    const drafts = items.filter((r) => r.status !== 'published')
    return Response.json({
      content: items,
      stats: { total: items.length, drafts: drafts.length, published: published.length },
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
