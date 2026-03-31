import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/reviews/list
 * Fetch all reviews directly from the reviews table, joined with brand data.
 * This replaces the old approach of going through brands API with review_status filter.
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    // Fetch all reviews with key fields (Range header bypasses 1000-row default)
    const reviews = await supabaseRequest(
      '/reviews?select=id,brand_id,title,slug,status,word_count,updated_at,published_at&order=updated_at.desc&limit=5000',
      { headers: { 'Range': '0-4999' } }
    )

    if (!Array.isArray(reviews)) {
      return Response.json({ error: 'Failed to fetch reviews' }, { status: 500 })
    }

    if (reviews.length === 0) {
      return Response.json({
        reviews: [],
        stats: { total: 0, drafts: 0, published: 0 },
      })
    }

    // Fetch associated brands in batched chunks to avoid URL length limits
    const brandIds = [...new Set(reviews.map((r) => r.brand_id).filter(Boolean))]
    let brandMap = {}

    if (brandIds.length > 0) {
      const CHUNK_SIZE = 80
      const chunks = []
      for (let i = 0; i < brandIds.length; i += CHUNK_SIZE) {
        chunks.push(brandIds.slice(i, i + CHUNK_SIZE))
      }

      const batchResults = await Promise.all(
        chunks.map((chunk) => {
          const idList = chunk.join(',')
          return supabaseRequest(
            `/scam_brands?id=in.(${idList})&select=id,name,slug,scam_score,total_creatives,total_geos,total_celebrities,velocity_7d,velocity_trend`
          )
        })
      )

      for (const brands of batchResults) {
        if (Array.isArray(brands)) {
          for (const b of brands) {
            brandMap[b.id] = b
          }
        }
      }
    }

    // Enrich reviews with brand data
    const enriched = reviews.map((r) => {
      const brand = brandMap[r.brand_id] || {}
      return {
        id: r.id,
        brand_id: r.brand_id,
        title: r.title,
        slug: r.slug,
        status: r.status || 'draft',
        word_count: r.word_count || 0,
        updated_at: r.updated_at,
        published_at: r.published_at,
        brand_name: brand.name || 'Unknown Brand',
        brand_slug: brand.slug || '',
        scam_score: brand.scam_score || 0,
        total_creatives: brand.total_creatives || 0,
        total_geos: brand.total_geos || 0,
        total_celebrities: brand.total_celebrities || 0,
        velocity_7d: brand.velocity_7d || 0,
        velocity_trend: brand.velocity_trend || 'stable',
      }
    })

    const drafts = enriched.filter((r) => r.status === 'draft')
    const published = enriched.filter((r) => r.status === 'published')

    return Response.json({
      reviews: enriched,
      stats: {
        total: enriched.length,
        drafts: drafts.length,
        published: published.length,
      },
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
