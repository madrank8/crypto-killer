import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * POST /api/admin/reviews/create
 * Create a blank review for a brand (no AI generation)
 * Body: { brand_id }
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    const { brand_id } = await request.json()

    if (!brand_id) {
      return Response.json(
        { error: 'brand_id is required' },
        { status: 400 }
      )
    }

    // Fetch brand data
    const brand = await supabaseRequest(
      `/scam_brands?id=eq.${brand_id}&select=*`
    )

    if (!Array.isArray(brand) || brand.length === 0) {
      return Response.json(
        { error: 'Brand not found' },
        { status: 404 }
      )
    }

    const brandData = brand[0]

    // Check if review already exists
    const existingReview = await supabaseRequest(
      `/reviews?brand_id=eq.${brand_id}&select=id`
    )

    if (Array.isArray(existingReview) && existingReview.length > 0) {
      // Return existing review ID
      return Response.json({
        review_id: existingReview[0].id,
        existing: true,
      })
    }

    // Generate slug from brand name
    const slug = brandData.slug || brandData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    // Create blank review
    const reviewPayload = {
      brand_id: brand_id,
      slug: slug,
      title: `Is ${brandData.name} a Scam? [${new Date().getFullYear()} Investigation]`,
      headline: '',
      meta_description: '',
      summary: '',
      how_it_works: '',
      red_flags: [],
      verdict: '',
      faq: [],
      full_article: '',
      scam_score: brandData.scam_score || 0,
      status: 'draft',
      ai_model: null,
      word_count: 0,
      updated_at: new Date().toISOString(),
    }

    const createResponse = await supabaseRequest('/reviews', {
      method: 'POST',
      body: JSON.stringify(reviewPayload),
      headers: { 'Prefer': 'return=representation' },
    })

    const reviewId = Array.isArray(createResponse)
      ? createResponse[0].id
      : createResponse.id

    return Response.json({
      review_id: reviewId,
      existing: false,
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
