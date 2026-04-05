import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

const SPYOWL_API = 'https://api.spyowl.icu';
const STALE_JOB_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

async function supaFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...(options.headers || {}),
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET', headers, body: options.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (options.method === 'HEAD') return null;
  if (options.method === 'PATCH' && options.headers?.Prefer === 'return=minimal') return null;
  return res.json();
}

/**
 * Auto-fail jobs stuck for over 1 hour before checking for conflicts
 */
async function cleanupStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS).toISOString();
  try {
    await supaFetch(
      `/sync_runs?status=in.("pending","running")&started_at=lt.${cutoff}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: 'Auto-failed: job exceeded 1-hour timeout',
        }),
      }
    );
  } catch (e) {
    console.error('Stale job cleanup failed:', e.message);
  }
}

async function getSpyOwlCookie() {
  try {
    const rows = await supaFetch('/settings?key=eq.spyowl_cookie&select=value');
    const token = rows?.[0]?.value?.trim() || '';
    if (!token) return '';
    return token.includes('=') ? token : `__Secure-spyowl.session_token=${token}`;
  } catch {
    return '';
  }
}

/**
 * POST /api/admin/scraper/trigger
 * Initiate an on-demand scrape
 * Body (optional): { geo_filter: "US,GB,DE" }
 */
export async function POST(request) {
  try {
    verifyAdmin(request);

    // Auto-fail stale jobs before checking for conflicts
    await cleanupStaleJobs();

    const body = await request.json().catch(() => ({}));
    const geoFilter = body.geo_filter || null;

    // Check if there's already a running/pending scrape
    const pending = await supaFetch(
      '/sync_runs?status=in.("pending","running")&select=id,status,started_at&order=started_at.desc&limit=1'
    );
    if (pending && pending.length > 0) {
      return Response.json({
        error: 'A scrape is already in progress',
        existing_job: pending[0],
      }, { status: 409 });
    }

    // Create the scrape job
    const jobData = {
      status: 'pending',
      trigger_type: 'manual',
      geo_filter: geoFilter,
      started_at: new Date().toISOString(),
      creatives_synced: 0,
      brands_updated: 0,
      new_creatives: 0,
      new_brands: 0,
      total_api: 0,
    };

    const inserted = await supaFetch('/sync_runs?select=id,status,started_at,trigger_type,geo_filter', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(jobData),
    });

    const job = inserted?.[0] || jobData;

    // Try to verify SpyOwl is reachable before marking as running
    const cookie = await getSpyOwlCookie();
    let spyowlReachable = false;

    if (cookie) {
      try {
        const res = await fetch(`${SPYOWL_API}/user/me`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(5000),
        });
        spyowlReachable = res.ok;
      } catch {
        spyowlReachable = false;
      }
    }

    if (!spyowlReachable) {
      // Update job to failed
      await supaFetch(`/sync_runs?id=eq.${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: cookie
            ? 'SpyOwl API unreachable or cookie expired'
            : 'No SpyOwl cookie configured',
        }),
      });
      return Response.json({
        success: false,
        job_id: job.id,
        error: cookie
          ? 'SpyOwl API unreachable — check your cookie in Settings'
          : 'No SpyOwl cookie configured — add it in Settings first',
      }, { status: 503 });
    }

    // Mark as running
    await supaFetch(`/sync_runs?id=eq.${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'running' }),
    });

    // Kick off the actual scrape via SpyOwl API
    let scrapeStarted = false;
    try {
      const scrapePayload = {};
      if (geoFilter) scrapePayload.geos = geoFilter.split(',').map(g => g.trim());

      const scrapeRes = await fetch(`${SPYOWL_API}/scrape/trigger`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...scrapePayload, job_id: job.id }),
        signal: AbortSignal.timeout(10000),
      });

      if (scrapeRes.ok) {
        scrapeStarted = true;
      } else {
        scrapeStarted = false;
      }
    } catch {
      scrapeStarted = false;
    }

    return Response.json({
      success: true,
      job_id: job.id,
      status: 'running',
      trigger_type: 'manual',
      geo_filter: geoFilter,
      spyowl_connected: true,
      scrape_triggered: scrapeStarted,
      message: scrapeStarted
        ? 'Scrape initiated via SpyOwl API'
        : 'Scrape job created — waiting for scraper to pick it up',
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
