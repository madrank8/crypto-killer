import { callModel, extractJSON } from '@/lib/ai-models'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { supaFetch } from '@/lib/supabase'
import { processVisuals } from '@/lib/visual-generator'
import { normalizeBrandLandingUrls, shapeReviewForSync } from '@/lib/sync-shape'

export const maxDuration = 300

async function syncPublishedReview(review, brand) {
  const replitUrl = process.env.REPLIT_SITE_URL
  const syncSecret = process.env.SYNC_SECRET
  if (!replitUrl || !syncSecret || !review || !brand) return null

  let landingUrls = []
  try {
    const rows = await supaFetch(
      `/brand_landing_pages?brand_id=eq.${brand.id}` +
      `&select=archive_url,archive_status,live_url,captured_at` +
      `&order=captured_at.desc&limit=20`
    )
    landingUrls = normalizeBrandLandingUrls(rows)
  } catch (err) {
    console.error('[regenerate-visuals] brand_landing_pages fetch failed:', err?.message)
  }

  const syncReview = shapeReviewForSync(review, brand, { landingUrls })
  const res = await fetch(`${replitUrl}/api/sync/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${syncSecret}`,
    },
    body: JSON.stringify({
      review: syncReview,
      brand,
      expected_full_article_length: syncReview.full_article_length ?? null,
      expected_full_article_hash: syncReview.full_article_hash ?? null,
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Live sync failed (${res.status}): ${text.slice(0, 240)}`)
  }
  return res.json()
}

/**
 * POST /api/admin/reviews/by-slug/[slug]/regenerate-visuals
 * Regenerates inline visual placeholders for one review slug and saves updates.
 * If the review is already published, it also triggers a live-site sync.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { slug } = await params
    if (!slug) {
      return Response.json({ error: 'slug is required' }, { status: 400 })
    }

    const reviews = await supaFetch(
      `/reviews?slug=eq.${encodeURIComponent(slug)}&select=id,slug,brand_id,status,full_article,visual_meta&limit=1`
    )
    const review = Array.isArray(reviews) ? reviews[0] : null
    if (!review) {
      return Response.json({ error: 'Review not found' }, { status: 404 })
    }
    if (!review.full_article || typeof review.full_article !== 'string') {
      return Response.json({ error: 'Review has no full_article content to process' }, { status: 400 })
    }

    const result = await processVisuals(review.full_article, {
      contentId: review.brand_id || review.id,
      contentType: 'review',
      aiHelpers: { callModel, extractJSON },
      imagenOnly: true,
    })

    const mergedVisualMeta = [
      ...(Array.isArray(review.visual_meta) ? review.visual_meta : []),
      ...(Array.isArray(result.visuals) ? result.visuals : []),
    ]

    await supaFetch(`/reviews?id=eq.${review.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        full_article: result.html,
        visual_meta: mergedVisualMeta,
        updated_at: new Date().toISOString(),
      }),
    })

    let liveSync = null
    if (review.status === 'published' && review.brand_id) {
      const brands = await supaFetch(`/scam_brands?id=eq.${review.brand_id}&select=*&limit=1`)
      const brand = Array.isArray(brands) ? brands[0] : null
      if (brand) {
        liveSync = await syncPublishedReview(
          {
            ...review,
            full_article: result.html,
            visual_meta: mergedVisualMeta,
            updated_at: new Date().toISOString(),
          },
          brand,
        )
      }
    }

    return Response.json({
      success: true,
      review_id: review.id,
      slug: review.slug,
      placeholders_total: result.stats?.total ?? 0,
      visuals_succeeded: result.stats?.succeeded ?? 0,
      visuals_failed: result.stats?.failed ?? 0,
      live_sync: liveSync,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
