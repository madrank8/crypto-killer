import { supaFetch } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

/**
 * POST /api/admin/reviews/[id]/sync
 * Manually sync a published review to the live site (Replit)
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

    // Call Replit sync webhook
    const syncRes = await fetch(`${replitUrl}/api/sync/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${syncSecret}`,
      },
      body: JSON.stringify({ review, brand }),
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

    return Response.json({
      success: true,
      review_id: id,
      slug: review.slug,
      live_site: replitUrl,
      sync_result: syncResult,
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
