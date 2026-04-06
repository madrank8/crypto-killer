import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/topical-map/maps
 * List topical maps (newest first).
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const rows = await supaFetch(
      '/topical_maps?select=id,name,description,status,stats,created_at,updated_at&order=created_at.desc'
    )

    return Response.json({ maps: Array.isArray(rows) ? rows : [] })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
