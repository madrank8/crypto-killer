import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * POST /api/admin/reviews/[id]/publish
 * Publish or unpublish a review
 * Body: { action: "publish" | "unpublish" }
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = params
    const { action } = await request.json()

    if (!action || !['publish', 'unpublish'].includes(action)) {
      return Response.json(
        { error: 'Invalid action. Must be "publish" or "unpublish"' },
        { status: 400 }
      )
    }

    // Prepare update payload
    const updates = {}

    if (action === 'publish') {
      updates.status = 'published'
      updates.published_at = new Date().toISOString()
    } else {
      updates.status = 'draft'
      updates.published_at = null
    }

    updates.updated_at = new Date().toISOString()

    // Perform update
    await supabaseRequest(
      `/reviews?id=eq.${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }
    )

    return Response.json({
      success: true,
      id,
      action,
      status: updates.status,
      published_at: updates.published_at,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
