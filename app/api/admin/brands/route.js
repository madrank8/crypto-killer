import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/brands
 * Returns brands sorted by triage priority with filtering and pagination
 * Query params: sort, trend, review_status, limit, offset
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const sort = searchParams.get('sort') || 'creative_volume'
    const trend = searchParams.get('trend') // surging, rising, stable, declining, dead
    const reviewStatus = searchParams.get('review_status') // none, draft, published
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500)
    const page = parseInt(searchParams.get('page') || '1')
    const offset = (page - 1) * limit

    // Build Supabase query
    let query = `/scam_brands?select=id,slug,name,scam_score,total_creatives,total_geos,total_celebrities,velocity_7d,velocity_trend,status,first_seen_at,last_seen_at`

    // Add filters based on trend
    if (trend && trend !== 'all') {
      query += `&velocity_trend=eq.${trend}`
    }

    // Add ordering
    const orderMap = {
      creative_volume: 'total_creatives.desc',
      velocity: 'velocity_7d.desc',
      scam_score: 'scam_score.desc',
    }
    const orderBy = orderMap[sort] || orderMap.creative_volume
    query += `&order=${orderBy}&limit=${limit}&offset=${offset}`

    // Fetch brands
    const brands = await supabaseRequest(query)

    if (!Array.isArray(brands)) {
      return Response.json(
        { error: 'Failed to fetch brands' },
        { status: 500 }
      )
    }

    // Fetch ALL reviews with pagination (Supabase caps at 1000 per request)
    const allReviews = []
    let reviewOffset = 0
    const reviewPageSize = 1000
    while (true) {
      const batch = await supabaseRequest(
        `/reviews?select=id,brand_id,status&limit=${reviewPageSize}&offset=${reviewOffset}`
      )
      if (!Array.isArray(batch) || batch.length === 0) break
      allReviews.push(...batch)
      if (batch.length < reviewPageSize) break
      reviewOffset += reviewPageSize
    }

    // Build review lookup map (prefer published over draft if multiple exist)
    const reviewMap = {}
    if (allReviews.length > 0) {
      allReviews.forEach((review) => {
        const existing = reviewMap[review.brand_id]
        if (!existing || (review.status === 'published' && existing.review_status !== 'published')) {
          reviewMap[review.brand_id] = {
            has_review: true,
            review_id: review.id,
            review_status: review.status,
          }
        }
      })
    }

    // Enrich brands with review data, renaming fields for frontend
    let enrichedBrands = brands.map((brand) => ({
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      scam_score: brand.scam_score,
      total_creatives: brand.total_creatives,
      velocity_7d: brand.velocity_7d,
      trend: brand.velocity_trend,
      geo_count: brand.total_geos,
      celebrity_count: brand.total_celebrities,
      status: brand.status,
      first_seen_at: brand.first_seen_at,
      last_seen_at: brand.last_seen_at,
      has_review: reviewMap[brand.id]?.has_review || false,
      review_id: reviewMap[brand.id]?.review_id || null,
      review_status: reviewMap[brand.id]?.review_status || null,
    }))

    // Filter by review_status if provided
    if (reviewStatus && reviewStatus !== 'all') {
      if (reviewStatus === 'none') {
        enrichedBrands = enrichedBrands.filter((b) => !b.has_review)
      } else if (reviewStatus === 'draft') {
        enrichedBrands = enrichedBrands.filter(
          (b) => b.review_status === 'draft'
        )
      } else if (reviewStatus === 'published') {
        enrichedBrands = enrichedBrands.filter(
          (b) => b.review_status === 'published'
        )
      }
    }

    return Response.json({
      brands: enrichedBrands,
      has_more: brands.length === limit,
      total: enrichedBrands.length,
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
