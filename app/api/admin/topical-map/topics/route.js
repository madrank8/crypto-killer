import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/topical-map/topics
 * Query: map_id (required), parent_id, content_type, content_status
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const { searchParams } = new URL(request.url)
    const mapId = searchParams.get('map_id')
    if (!mapId) {
      return Response.json({ error: 'map_id is required' }, { status: 400 })
    }

    let query = `/topics?map_id=eq.${mapId}&select=*&order=sort_order.asc`

    const parentId = searchParams.get('parent_id')
    if (parentId === 'null' || parentId === '') {
      query += '&parent_id=is.null'
    } else if (parentId) {
      query += `&parent_id=eq.${parentId}`
    }

    const contentType = searchParams.get('content_type')
    if (contentType) {
      query += `&content_type=eq.${encodeURIComponent(contentType)}`
    }

    const contentStatus = searchParams.get('content_status')
    if (contentStatus) {
      query += `&content_status=eq.${encodeURIComponent(contentStatus)}`
    }

    const rows = await supaFetch(query)

    return Response.json({ topics: Array.isArray(rows) ? rows : [] })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/topical-map/topics
 *
 * Phase 4 — Free-form topic creation. Accepts a topic with optional `map_id`
 * so users can create a standalone topic decoupled from the topical-map flow.
 * The topic_type / content_type / target_keyword fields are user-controlled
 * rather than auto-derived from the map generator.
 *
 * Body:
 *   {
 *     title: string                    // required
 *     content_type: string             // required, must match topics_content_type_check enum
 *     topic_type?: string              // defaults to 'supporting' (must match topic_type enum)
 *     target_keyword?: string          // defaults to title
 *     description?: string
 *     notes?: string
 *     map_id?: string | null           // optional — null = standalone (no map binding)
 *     parent_id?: string | null
 *   }
 *
 * Returns: { topic } — the created row (full).
 *
 * Validation against the DB CHECK constraints lives at the DB level — Postgres
 * will reject invalid enum values. We surface those as 400 errors.
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

export async function POST(request) {
  try {
    verifyAdmin(request)

    const body = await request.json().catch(() => ({}))
    const title = String(body?.title || '').trim()
    const contentType = String(body?.content_type || '').trim()
    const topicType = String(body?.topic_type || 'supporting').trim()

    if (!title) {
      return Response.json({ error: 'title is required' }, { status: 400 })
    }
    if (!contentType) {
      return Response.json({ error: 'content_type is required' }, { status: 400 })
    }
    if (!VALID_CONTENT_TYPES.has(contentType)) {
      return Response.json(
        { error: `Invalid content_type: ${contentType}` },
        { status: 400 },
      )
    }
    if (!VALID_TOPIC_TYPES.has(topicType)) {
      return Response.json(
        { error: `Invalid topic_type: ${topicType}` },
        { status: 400 },
      )
    }

    const targetKeyword = String(body?.target_keyword || title).trim()
    const description = body?.description ? String(body.description).trim() : null
    const notes = body?.notes ? String(body.notes).trim() : null
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
        description,
        notes,
        map_id: mapId,
        parent_id: parentId,
        content_status: 'planned',
        priority_score: 50,
      }),
    })

    const topic = Array.isArray(inserted) ? inserted[0] : inserted
    if (!topic?.id) {
      return Response.json(
        { error: 'Failed to create topic (no row returned)' },
        { status: 500 },
      )
    }

    return Response.json({ topic })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    // Bubble up Postgres CHECK constraint violations as 400s
    if (error.message?.includes('topics_content_type_check') ||
        error.message?.includes('topics_topic_type_check')) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
