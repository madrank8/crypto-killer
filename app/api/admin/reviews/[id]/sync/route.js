import { supaFetch } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

// Map our internal red_flag shape { flag, detail } → live-site shape
// { title, description } while keeping the legacy keys for backwards
// compatibility. Replit's `red_flags` table has a NOT NULL `title` column,
// so the raw pass-through was failing with a 500 on publish.
function shapeReviewForSync(review) {
  if (!review) return review;
  const red_flags = (review.red_flags || []).map((rf) => {
    const src = rf || {};
    const title = src.title || src.flag || '';
    const description = src.description || src.detail || '';
    return { ...src, title, description, flag: src.flag || title, detail: src.detail || description };
  });
  const faq = (review.faq || []).map((q) => {
    const src = q || {};
    return {
      ...src,
      question: src.question || src.q || src.title || '',
      answer: src.answer || src.a || src.body || '',
    };
  });
  return { ...review, red_flags, faq };
}

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

    // Call Replit sync webhook — shape red_flags/faq to match live-site DB cols
    const syncRes = await fetch(`${replitUrl}/api/sync/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${syncSecret}`,
      },
      body: JSON.stringify({ review: shapeReviewForSync(review), brand }),
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
