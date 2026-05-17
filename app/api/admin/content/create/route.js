import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * POST /api/admin/content/create
 *
 * Two modes:
 *
 *   1. Topic-driven (legacy):
 *      Body: { topic_id }
 *      Creates a blank content draft for an existing topic, or returns the
 *      existing one if the topic is already linked to content.
 *
 *   2. Free-form (Phase 4):
 *      Body: { title, content_type, topic_type?, target_keyword?, map_id? }
 *      Creates a topic first (via the same Postgres rules as POST
 *      /api/admin/topical-map/topics) then a blank content draft. The new
 *      topic is standalone (map_id null) by default.
 *
 * Returns: { id, slug, existing, topic_id }
 */

const VALID_TOPIC_TYPES = new Set(['pillar', 'cluster', 'supporting', 'brand_review'])
const VALID_CONTENT_TYPES = new Set([
  'pillar_page',
  'guide',
  'educational',
  'comparison',
  'recovery_guide',
  'prevention',
  'brand_review',
  'listicle',
  'glossary',
  'blog_post',
  'informational_page',
  'landing_page',
])

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

async function createTopicFreeForm(body) {
  const title = String(body?.title || '').trim()
  const contentType = String(body?.content_type || '').trim()
  const topicType = String(body?.topic_type || 'supporting').trim()

  if (!title) throw new Error('title is required')
  if (!contentType) throw new Error('content_type is required')
  if (!VALID_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Invalid content_type: ${contentType}`)
  }
  if (!VALID_TOPIC_TYPES.has(topicType)) {
    throw new Error(`Invalid topic_type: ${topicType}`)
  }

  const targetKeyword = String(body?.target_keyword || title).trim()
  const mapId = body?.map_id || null
  const parentId = body?.parent_id || null

  const inserted = await supaFetch('/topics?select=*', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      title,
      topic_type: topicType,
      content_type: contentType,
      target_keyword: targetKeyword,
      map_id: mapId,
      parent_id: parentId,
      content_status: 'planned',
      priority_score: 50,
    }),
  })

  const topic = Array.isArray(inserted) ? inserted[0] : inserted
  if (!topic?.id) throw new Error('Failed to create topic (no row returned)')
  return topic
}

export async function POST(request) {
  try {
    verifyAdmin(request)

    const body = await request.json()
    let topic

    if (body?.topic_id) {
      // Mode 1: legacy topic-driven
      const topicRows = await supaFetch(
        `/topics?id=eq.${body.topic_id}&select=id,title,target_keyword,content_type,content_id&limit=1`,
      )
      topic = Array.isArray(topicRows) ? topicRows[0] : null
      if (!topic) {
        return Response.json({ error: 'Topic not found' }, { status: 404 })
      }

      // If topic already has content, return the existing content ID
      if (topic.content_id) {
        return Response.json({
          id: topic.content_id,
          existing: true,
          topic_id: topic.id,
        })
      }
    } else if (body?.title && body?.content_type) {
      // Mode 2: free-form (Phase 4)
      topic = await createTopicFreeForm(body)
    } else {
      return Response.json(
        { error: 'Either topic_id, or { title, content_type } is required' },
        { status: 400 },
      )
    }

    // Create a blank content draft (same logic for both modes)
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

    return Response.json({
      id: content.id,
      slug: content.slug,
      existing: false,
      topic_id: topic.id,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    if (error.message?.includes('topics_content_type_check') ||
        error.message?.includes('topics_topic_type_check')) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
