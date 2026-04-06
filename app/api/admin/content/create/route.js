import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * POST /api/admin/content/create
 * Creates a blank content draft for a topic, or returns the existing one.
 * Body: { topic_id }
 * Returns: { id, slug, existing }
 */

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180) || 'guide'
}

async function ensureUniqueContentSlug(base) {
  const cleanBase = slugify(base)
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? cleanBase : `${cleanBase}-${attempt + 1}`
    const rows = await supaFetch(`/content?slug=eq.${candidate}&select=id&limit=1`)
    if (!Array.isArray(rows) || rows.length === 0) return candidate
  }
  return `${cleanBase}-${Date.now()}`
}

export async function POST(request) {
  try {
    verifyAdmin(request)

    const body = await request.json()
    const topicId = body?.topic_id
    if (!topicId) {
      return Response.json({ error: 'topic_id is required' }, { status: 400 })
    }

    // Load the topic
    const topicRows = await supaFetch(`/topics?id=eq.${topicId}&select=id,title,target_keyword,content_type,content_id&limit=1`)
    const topic = Array.isArray(topicRows) ? topicRows[0] : null
    if (!topic) {
      return Response.json({ error: 'Topic not found' }, { status: 404 })
    }

    // If topic already has content, return the existing content ID
    if (topic.content_id) {
      return Response.json({ id: topic.content_id, existing: true })
    }

    // Create a blank content draft
    const slug = await ensureUniqueContentSlug(topic.target_keyword || topic.title)

    const inserted = await supaFetch('/content?select=id,slug', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        topic_id: topic.id,
        content_type: topic.content_type || 'guide',
        title: topic.title || '',
        headline: '',
        slug,
        meta_description: '',
        summary: '',
        full_article: '',
        sections: null,
        faq: null,
        sources: null,
        internal_links: null,
        word_count: 0,
        status: 'draft',
        updated_at: new Date().toISOString(),
      }),
    })

    const content = Array.isArray(inserted) ? inserted[0] : inserted
    if (!content?.id) {
      return Response.json({ error: 'Failed to create content record' }, { status: 500 })
    }

    // Link content back to the topic
    await supaFetch(`/topics?id=eq.${topic.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        content_id: content.id,
        content_status: 'draft',
        updated_at: new Date().toISOString(),
      }),
    })

    return Response.json({ id: content.id, slug: content.slug, existing: false })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
