import { revalidatePath } from 'next/cache'
import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

// Map our internal red_flag shape { flag, detail } → live-site shape
// { title, description } while keeping legacy keys for backwards compat.
// Replit's `red_flags` table has a NOT NULL `title` column, so the raw
// pass-through was 500'ing on publish. Same helper lives in the /sync route.
function shapeReviewForSync(review) {
  if (!review) return review
  const red_flags = (review.red_flags || []).map((rf) => {
    const src = rf || {}
    const title = src.title || src.flag || ''
    const description = src.description || src.detail || ''
    return { ...src, title, description, flag: src.flag || title, detail: src.detail || description }
  })
  const faq = (review.faq || []).map((q) => {
    const src = q || {}
    return {
      ...src,
      question: src.question || src.q || src.title || '',
      answer: src.answer || src.a || src.body || '',
    }
  })
  return { ...review, red_flags, faq }
}

/**
 * POST /api/admin/reviews/[id]/publish
 * Publish or unpublish a review
 * Body: { action: "publish" | "unpublish" }
 *
 * On publish: also syncs the review to the live site (Replit) via webhook
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
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

    // Fetch the review for revalidation and sync
    const reviewData = await supaFetch(`/reviews?id=eq.${id}&select=*`)
    const review = Array.isArray(reviewData) ? reviewData[0] : null
    const reviewSlug = review?.slug

    // Perform update
    await supaFetch(
      `/reviews?id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(updates),
      }
    )

    // Also mirror the publish state onto the linked scam_brand row.
    // The Replit live-site sync runs a two-phase job: Phase A walks
    // scam_brands and stamps each matching review's status from
    // brand.review_status. If we only flip reviews.status here, Phase A
    // will fight us on every cron tick and eventually win. Setting
    // scam_brands.review_status in the same moment makes both phases
    // agree. See the 2026-04-20 incident notes.
    if (review?.brand_id) {
      try {
        await supaFetch(
          `/scam_brands?id=eq.${review.brand_id}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              review_status: action === 'publish' ? 'published' : 'pending',
              updated_at: new Date().toISOString(),
            }),
          },
        )
      } catch (brandUpdateErr) {
        // Non-fatal — the review itself is already flipped. Log and move on.
        console.error('[publish] scam_brands.review_status mirror failed:', brandUpdateErr.message)
      }
    }

    // Revalidate cached pages so changes appear immediately
    try {
      if (reviewSlug) revalidatePath(`/review/${reviewSlug}`)
      revalidatePath('/')
      revalidatePath('/scams')
    } catch (revalError) {
      console.error('Revalidation error (non-fatal):', revalError.message)
    }

    // ─── SYNC TO LIVE SITE (on publish only) ───
    let syncStatus = null
    if (action === 'publish' && review) {
      const replitUrl = process.env.REPLIT_SITE_URL
      const syncSecret = process.env.SYNC_SECRET

      if (replitUrl && syncSecret) {
        try {
          // Fetch brand data
          let brand = null
          if (review.brand_id) {
            const brands = await supaFetch(
              `/scam_brands?id=eq.${review.brand_id}&select=*&limit=1`
            )
            brand = brands?.[0]
          }

          if (brand) {
            // Merge the updated fields into the review object for sync,
            // then reshape red_flags/faq to match the live site's schema.
            const syncReview = shapeReviewForSync({ ...review, ...updates })

            const syncRes = await fetch(`${replitUrl}/api/sync/review`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${syncSecret}`,
              },
              body: JSON.stringify({ review: syncReview, brand }),
              signal: AbortSignal.timeout(30000),
            })

            if (syncRes.ok) {
              const syncResult = await syncRes.json()
              syncStatus = { success: true, review_id: syncResult.review_id }
              console.log(`[publish] Synced to live site: ${reviewSlug}`)
            } else {
              const text = await syncRes.text().catch(() => '')
              syncStatus = { success: false, error: `${syncRes.status}: ${text}` }
              console.error(`[publish] Live sync failed: ${syncRes.status} ${text}`)
            }
          } else {
            syncStatus = { success: false, error: 'No brand data found' }
          }
        } catch (syncErr) {
          syncStatus = { success: false, error: syncErr.message }
          console.error('[publish] Live sync error:', syncErr.message)
        }
      }
    }

    return Response.json({
      success: true,
      id,
      action,
      status: updates.status,
      published_at: updates.published_at,
      live_sync: syncStatus,
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
