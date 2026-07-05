import { supaFetch } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import { shapeContentForSync } from '@/lib/content-sync-shape';

/**
 * POST /api/admin/content/[id]/sync
 * Manually sync a published content article to the live blog site (Replit).
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

    // Fetch content with all fields
    const contentRows = await supaFetch(
      `/content?id=eq.${id}&select=*&limit=1`
    );
    const content = contentRows?.[0];
    if (!content) {
      return Response.json({ error: 'Content not found' }, { status: 404 });
    }

    if (content.status !== 'published') {
      return Response.json(
        { error: 'Content must be published before syncing' },
        { status: 400 }
      );
    }

    // Fetch linked topic data
    let topic = null;
    if (content.topic_id) {
      const topicRows = await supaFetch(
        `/topics?id=eq.${content.topic_id}&select=*&limit=1`
      );
      topic = topicRows?.[0];
    }

    // Build sync payload — schema columns canonicalized to the resolver
    // JSON-LD shapes (audit 2026-07-05, A4).
    const payload = {
      content: shapeContentForSync(content),
      topic,
      destination: 'blog',
      url: `/blog/${content.slug}`,
    };

    // Try multiple sync endpoints on the live site
    const endpoints = ['/api/sync/blog', '/api/sync/content', '/api/sync/post'];
    let lastErr = null;

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${replitUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${syncSecret}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return Response.json({
            success: true,
            content_id: id,
            slug: content.slug,
            endpoint,
            live_site: replitUrl,
            sync_result: data,
          });
        }

        const text = await res.text().catch(() => '');
        lastErr = `${endpoint}: ${res.status} ${text}`;
      } catch (e) {
        lastErr = `${endpoint}: ${e.message}`;
      }
    }

    return Response.json(
      { error: `Live site sync failed on all endpoints. Last: ${lastErr}` },
      { status: 502 }
    );
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
