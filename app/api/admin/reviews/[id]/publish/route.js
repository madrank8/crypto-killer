import { revalidatePath } from 'next/cache'
import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

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
            // Merge the updated fields into the review object for sync
            const syncReview = { ...review, ...updates }

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
