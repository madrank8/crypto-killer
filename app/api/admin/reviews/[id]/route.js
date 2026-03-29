import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/reviews/[id]
 * Fetch a single review with associated brand data
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = params

    // Fetch review
    const reviewData = await supabaseRequest(
      `/reviews?id=eq.${id}&select=*`
    )

    if (!Array.isArray(reviewData) || reviewData.length === 0) {
      return Response.json(
        { error: 'Review not found' },
        { status: 404 }
      )
    }

    const review = reviewData[0]

    // Fetch associated brand
    const brandData = await supabaseRequest(
      `/scam_brands?id=eq.${review.brand_id}&select=*`
    )

    const brand = Array.isArray(brandData) ? brandData[0] : null

    return Response.json({
      ...review,
      brand,
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

/**
 * PATCH /api/admin/reviews/[id]
 * Update review fields and recalculate word_count if full_article changed
 */
export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = params
    const updates = await request.json()

    // Calculate word count if full_article is being updated
    if (updates.full_article) {
      updates.word_count = updates.full_article.split(/\s+/).length
    }

    // Always update updated_at
    updates.updated_at = new Date().toISOString()

    // Perform update
    await supabaseRequest(
      `/reviews?id=eq.${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
        headers: { 'Prefer': 'return=minimal' },
      }
    )

    return Response.json({
      success: true,
      id,
      updates: {
        ...updates,
        id,
      },
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
