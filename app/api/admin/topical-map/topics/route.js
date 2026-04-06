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
