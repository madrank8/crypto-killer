import { supaFetch } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import { shapeReviewForSync, normalizeBrandLandingUrls } from '@/lib/sync-shape';

/**
 * POST /api/admin/reviews/[id]/sync
 * Manually sync a published review to the live site (Replit)
 *
 * The full Supabase→Replit shape transform lives in lib/sync-shape.js
 * and is shared with the /publish route. That module handles field name
 * renames, funnel-stage parsing, stats assembly, geo region grouping,
 * and placeholder stripping. This route is just the POST wrapper.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request);

    const { id } = await params;
    const replitUrl = process.env.REPLIT_SITE_URL;
    const syncSecret = process.env.SYNC_SECRET;

    if (!replitUrl || !syncSecret) {
      return Response.json(
        { error: 'REPLIT_SITE_URL and SYNC_SECRET must be configured' },
        { status: 500 }
      );
    }

    // Fetch review with all fields
    const reviews = await supaFetch(
      `/reviews?id=eq.${id}&select=*&limit=1`
    );
    const review = reviews?.[0];
    if (!review) {
      return Response.json({ error: 'Review not found' }, { status: 404 });
    }

    // Fetch associated brand data
    let brand = null;
    if (review.brand_id) {
      const brands = await supaFetch(
        `/scam_brands?id=eq.${review.brand_id}&select=*&limit=1`
      );
      brand = brands?.[0];
    }

    if (!brand) {
      return Response.json(
        { error: 'No brand data found for this review' },
        { status: 400 }
      );
    }

    // Wayback snapshots for claims[].appearance. Soft-fail: if the fetch
    // errors or returns nothing, shapeReviewForSync's internal fallback
    // picks up brand.landing_urls (live URLs) so sync still works.
    let landingUrls = [];
    try {
      const rows = await supaFetch(
        `/brand_landing_pages?brand_id=eq.${brand.id}` +
          `&select=archive_url,archive_status,live_url,captured_at` +
          `&order=captured_at.desc&limit=20`
      );
      landingUrls = normalizeBrandLandingUrls(rows);
    } catch (e) {
      console.error('[manual-sync] brand_landing_pages fetch failed (non-fatal):', e?.message);
      landingUrls = [];
    }

    // Call Replit sync webhook — shape Supabase review + brand into the
    // decomposed payload Replit's sync/review endpoint expects.
    const syncReview = shapeReviewForSync(review, brand, { landingUrls });
    const syncRes = await fetch(`${replitUrl}/api/sync/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${syncSecret}`,
      },
      body: JSON.stringify({
        review: syncReview,
        brand,
        expected_full_article_length: syncReview.full_article_length ?? null,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!syncRes.ok) {
      const text = await syncRes.text().catch(() => '');
      return Response.json(
        { error: `Live site sync failed: ${syncRes.status} ${text}` },
        { status: 502 }
      );
    }

    const syncResult = await syncRes.json();
    const expectedLen = Number(syncReview.full_article_length ?? 0);
    const receivedLen = Number(syncResult?.full_article_length ?? -1);
    const lengthMatches = receivedLen === expectedLen;

    return Response.json({
      success: lengthMatches,
      review_id: id,
      slug: review.slug,
      live_site: replitUrl,
      expected_full_article_length: expectedLen,
      received_full_article_length: receivedLen,
      full_article_length_matches: lengthMatches,
      sync_result: syncResult,
      ...(lengthMatches ? {} : { error: 'full_article length mismatch on live sync' }),
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
