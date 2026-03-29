import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/stats
 * Returns dashboard KPIs: total brands, creatives, active brands, reviews
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const [allBrands, allReviews] = await Promise.all([
      supabaseRequest('/scam_brands?select=id,velocity_7d,total_creatives&limit=10000'),
      supabaseRequest('/reviews?select=id,status&limit=10000'),
    ])

    const totalBrands = Array.isArray(allBrands) ? allBrands.length : 0
    const activeBrands = Array.isArray(allBrands)
      ? allBrands.filter((b) => b.velocity_7d > 0).length
      : 0
    const totalCreatives = Array.isArray(allBrands)
      ? allBrands.reduce((sum, b) => sum + (b.total_creatives || 0), 0)
      : 0

    const reviewsPublished = Array.isArray(allReviews)
      ? allReviews.filter((r) => r.status === 'published').length
      : 0
    const reviewsDraft = Array.isArray(allReviews)
      ? allReviews.filter((r) => r.status === 'draft').length
      : 0

    return Response.json({
      total_brands: totalBrands,
      total_creatives: totalCreatives,
      active_brands: activeBrands,
      published_reviews: reviewsPublished,
      draft_reviews: reviewsDraft,
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
