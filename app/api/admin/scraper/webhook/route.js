import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase';
import { timingSafeEqual } from 'crypto';

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/admin/scraper/webhook
 * Called by the external scraper to update job status
 * Auth: Bearer token matching ADMIN_SECRET or SCRAPER_SECRET
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const validTokens = [
      process.env.ADMIN_SECRET,
      process.env.SCRAPER_SECRET,
    ].filter(Boolean);

    if (!token || !validTokens.some(t => safeCompare(token, t))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      job_id, status, creatives_synced, brands_updated,
      new_creatives, new_brands, total_api, error_message,
    } = body;

    if (!job_id) {
      return Response.json({ error: 'job_id required' }, { status: 400 });
    }

    const allowedStatuses = ['running', 'completed', 'failed'];
    if (status && !allowedStatuses.includes(status)) {
      return Response.json({
        error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
      }, { status: 400 });
    }

    const update = {};
    if (status) update.status = status;
    if (typeof creatives_synced === 'number') update.creatives_synced = creatives_synced;
    if (typeof brands_updated === 'number') update.brands_updated = brands_updated;
    if (typeof new_creatives === 'number') update.new_creatives = new_creatives;
    if (typeof new_brands === 'number') update.new_brands = new_brands;
    if (typeof total_api === 'number') update.total_api = total_api;
    if (error_message) update.error_message = error_message;
    if (body.progress && typeof body.progress === 'object') update.progress = body.progress;
    if (status === 'completed' || status === 'failed') {
      update.finished_at = new Date().toISOString();
    }

    const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${writeKey}`,
      apikey: writeKey,
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_runs?id=eq.${job_id}`,
      { method: 'PATCH', headers, body: JSON.stringify(update) }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase update failed: ${res.status} ${text}`);
    }

    return Response.json({ success: true, job_id, updated: update });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
