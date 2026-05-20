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
      console.warn('[manual-sync] brand_landing_pages fetch failed (non-fatal):', e?.message);
      landingUrls = [];
    }

    // ─── Pull translations + recent ads IN PARALLEL ──────────────────
    // Both lookups depend only on review/brand IDs (already known), not on
    // each other — so Promise.all halves the wall-clock latency on this
    // pre-sync prep step. Each lookup soft-fails to its empty-array fallback;
    // they're independently optional and never block the sync.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [translations, recentAds] = await Promise.all([
      // Published translations only — drafts stay on Vercel and are never
      // canonical-synced. Drives hreflang, notranslate, and locale routes.
      supaFetch(
        `/review_translations?review_id=eq.${review.id}&status=eq.published&select=*&order=locale.asc`
      )
        .then((rows) => (Array.isArray(rows) ? rows : []))
        .catch((e) => {
          console.warn('[manual-sync] translations fetch failed (non-fatal):', e?.message);
          return [];
        }),

      // Last-7d ads for the brand, joined with creative_text in one PostgREST
      // embed. PostgREST returns the embed as either an array (when relationship
      // cardinality is ambiguous) or single object, so we normalize both shapes
      // below.
      supaFetch(
        `/creatives?normalized_offer=eq.${encodeURIComponent(brand.normalized_name || '')}` +
          `&first_seen_at=gte.${encodeURIComponent(since)}` +
          `&select=id,offer_name,celebrity_name,geo,land_language,is_video,created_at,first_seen_at,creative_text(main_text,link_text,link_url,post_url,fp_link)` +
          `&order=first_seen_at.desc&limit=20`
      )
        .then((rows) =>
          (Array.isArray(rows) ? rows : []).map((r) => {
            const t = Array.isArray(r.creative_text) ? r.creative_text[0] : r.creative_text || {};
            return {
              creative_id: r.id,
              offer_name: r.offer_name,
              celebrity_name: r.celebrity_name,
              geo: r.geo,
              land_language: r.land_language,
              is_video: r.is_video,
              spyowl_created_at: r.created_at,
              first_seen_at: r.first_seen_at,
              main_text: t?.main_text,
              link_text: t?.link_text,
              link_url: t?.link_url,
              post_url: t?.post_url,
              fp_link: t?.fp_link,
            };
          })
        )
        .catch((e) => {
          console.warn('[manual-sync] recent ads fetch failed (non-fatal):', e?.message);
          return [];
        }),
    ]);

    // Call Replit sync webhook — shape Supabase review + brand into the
    // decomposed payload Replit's sync/review endpoint expects.
    const syncReview = shapeReviewForSync(review, brand, { landingUrls, translations, recentAds });
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
        expected_full_article_hash: syncReview.full_article_hash ?? null,
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
    const lengthOk = receivedLen < 0 || lengthMatches;
    const expectedHash = String(syncReview.full_article_hash ?? '');
    const storedHash = String(syncResult?.full_article_hash ?? '');
    const incomingHash = String(syncResult?.incoming_full_article_hash ?? '');
    const liveSyncOk = syncResult?.ok === true;
    const explicitIntegrityFail = syncResult?.full_article_hash_matches === false;
    const rescueIntegrity =
      expectedHash.length === 64 &&
      incomingHash === expectedHash &&
      lengthOk;
    const integrityOk = !explicitIntegrityFail || rescueIntegrity;
    const hashMatches = liveSyncOk && integrityOk;

    return Response.json({
      success: hashMatches,
      review_id: id,
      slug: review.slug,
      live_site: replitUrl,
      expected_full_article_length: expectedLen,
      received_full_article_length: receivedLen,
      full_article_length_matches: lengthMatches,
      expected_full_article_hash: expectedHash,
      received_full_article_hash: storedHash,
      received_incoming_full_article_hash: incomingHash,
      full_article_hash_matches: hashMatches,
      sync_result: syncResult,
      ...(hashMatches
        ? {}
        : {
            error: !liveSyncOk
              ? 'live site sync response missing ok: true'
              : 'full_article hash mismatch on live sync',
          }),
    });
  } catch (error) {
    if (String(error?.message || '').includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
