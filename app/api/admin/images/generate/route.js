import { revalidatePath } from 'next/cache';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import { generateImageSet, generateImage } from '@/lib/images';
import { supabaseRequest } from '@/lib/supabase';

export const maxDuration = 300; // Midjourney polling takes 30-90s, plus TinyPNG + Supabase uploads

/**
 * POST /api/admin/images/generate
 *
 * Generates images for a review or content piece.
 *
 * Body options:
 *   { review_id }           — generate & attach images for a review
 *   { content_id }          — generate & attach images for a content piece
 *   { slug, type }          — generate a standalone image set (returns URLs, doesn't attach)
 *   { query, type, filename } — generate a single image from a custom query
 */
export async function POST(request) {
  try {
    verifyAdmin(request);
    const body = await request.json();

    // Validate IDs before they're interpolated into PostgREST filter strings.
    // Both feed a PATCH (?id=eq.${...}); an unvalidated value could alter the
    // WHERE clause and broaden the update beyond the intended row.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (body.review_id && !UUID_RE.test(String(body.review_id))) {
      return Response.json({ error: 'Invalid review_id' }, { status: 400 });
    }
    if (body.content_id && !UUID_RE.test(String(body.content_id))) {
      return Response.json({ error: 'Invalid content_id' }, { status: 400 });
    }

    // ─── Mode 1: Generate for a specific review ───
    if (body.review_id) {
      const reviews = await supabaseRequest(
        `/reviews?id=eq.${body.review_id}&select=id,slug,hero_image_url`
      );
      const review = reviews?.[0];
      if (!review) {
        return Response.json({ error: 'Review not found' }, { status: 404 });
      }

      const contentCount = body.content_count ?? 1;
      const result = await generateImageSet(review.slug, { contentCount });

      // Save to review record
      const update = {};
      if (result.hero) {
        update.hero_image_url = result.hero.url;
        update.hero_image_alt = result.hero.alt;
        update.hero_image_credit = result.hero.credit;
      }
      if (result.contentImages.length > 0) {
        update.content_images = result.contentImages.map(img => ({
          url: img.url,
          alt: img.alt,
          credit: img.credit,
          creditUrl: img.creditUrl,
          placement: img.placement,
        }));
      }

      if (Object.keys(update).length > 0) {
        await supabaseRequest(`/reviews?id=eq.${body.review_id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(update),
        });
      }

      // Purge ISR cache so the public page reflects new images
      try {
        revalidatePath(`/review/${review.slug}`);
        revalidatePath('/');
      } catch (_) { /* non-fatal */ }

      return Response.json({
        success: true,
        review_id: body.review_id,
        hero: result.hero ? {
          url: result.hero.url,
          alt: result.hero.alt,
          credit: result.hero.credit,
          source: result.hero.source,
          prompt: result.hero.query,
          compressed: `${result.hero.originalSize} → ${result.hero.compressedSize} bytes`,
        } : null,
        content_images: result.contentImages.map(img => ({
          url: img.url,
          alt: img.alt,
          credit: img.credit,
          source: img.source,
          prompt: img.query,
          placement: img.placement,
        })),
        errors: result.errors,
      });
    }

    // ─── Mode 2: Generate for a specific content piece ───
    if (body.content_id) {
      const contents = await supabaseRequest(
        `/content?id=eq.${body.content_id}&select=id,slug,hero_image_url`
      );
      const content = contents?.[0];
      if (!content) {
        return Response.json({ error: 'Content not found' }, { status: 404 });
      }

      const contentCount = body.content_count ?? 1;
      const result = await generateImageSet(content.slug, { contentCount });

      const update = {};
      if (result.hero) {
        update.hero_image_url = result.hero.url;
        update.hero_image_alt = result.hero.alt;
        update.hero_image_credit = result.hero.credit;
      }
      if (result.contentImages.length > 0) {
        update.content_images = result.contentImages.map(img => ({
          url: img.url,
          alt: img.alt,
          credit: img.credit,
          creditUrl: img.creditUrl,
          placement: img.placement,
        }));
      }

      if (Object.keys(update).length > 0) {
        await supabaseRequest(`/content?id=eq.${body.content_id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(update),
        });
      }

      // Purge ISR cache for blog content
      try {
        revalidatePath(`/blog/${content.slug}`);
        revalidatePath('/blog');
      } catch (_) { /* non-fatal */ }

      return Response.json({
        success: true,
        content_id: body.content_id,
        hero: result.hero ? { url: result.hero.url, alt: result.hero.alt, credit: result.hero.credit } : null,
        content_images: result.contentImages.map(img => ({
          url: img.url, alt: img.alt, credit: img.credit, placement: img.placement,
        })),
        errors: result.errors,
      });
    }

    // ─── Mode 3: Standalone image set ───
    if (body.slug) {
      const contentCount = body.content_count ?? 1;
      const result = await generateImageSet(body.slug, { contentCount });
      return Response.json({ success: true, ...result });
    }

    // ─── Mode 4: Single custom image ───
    if (body.query) {
      const img = await generateImage({
        type: body.type || 'hero',
        customQuery: body.query,
        filename: body.filename || '',
      });
      return Response.json({ success: true, image: img });
    }

    return Response.json(
      { error: 'Provide review_id, content_id, slug, or query' },
      { status: 400 }
    );
  } catch (error) {
    if (error.message?.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    console.error('[images/generate] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
