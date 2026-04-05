import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

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
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  if (options.method === 'HEAD' || options.method === 'PATCH') return null;
  return res.json();
}

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
    console.error('Cron stale job cleanup failed:', e.message);
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
 * GET /api/cron/scrape
 * Vercel Cron Job — runs every 24 hours at midnight UTC
 * Secured by CRON_SECRET env var
 */
export async function GET(request) {
  try {
    // Verify cron authorization
    const authHeader = request.headers.get('Authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
      const token = authHeader.replace('Bearer ', '').trim();
      if (token !== cronSecret) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Auto-fail stale jobs before checking for conflicts
    await cleanupStaleJobs();

    // Check if there's already a running/pending scrape
    const pending = await supaFetch(
      '/sync_runs?status=in.("pending","running")&select=id,status,started_at&limit=1'
    );
    if (pending && pending.length > 0) {
      return Response.json({
        skipped: true,
        reason: 'Scrape already in progress',
        existing_job: pending[0],
      });
    }

    // Check SpyOwl connectivity
    const cookie = await getSpyOwlCookie();
    if (!cookie) {
      await supaFetch('/sync_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed',
          trigger_type: 'scheduled',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error_message: 'No SpyOwl cookie configured',
        }),
      });
      return Response.json(
        { success: false, error: 'No SpyOwl cookie configured' },
        { status: 503 }
      );
    }

    // Verify SpyOwl is reachable
    let spyowlOk = false;
    try {
      const res = await fetch(`${SPYOWL_API}/user/me`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(5000),
      });
      spyowlOk = res.ok;
    } catch {
      spyowlOk = false;
    }

    if (!spyowlOk) {
      await supaFetch('/sync_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed',
          trigger_type: 'scheduled',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error_message: 'SpyOwl API unreachable or cookie expired',
        }),
      });
      return Response.json(
        { success: false, error: 'SpyOwl unreachable' },
        { status: 503 }
      );
    }

    // Create the scrape job
    const inserted = await supaFetch('/sync_runs?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'running',
        trigger_type: 'scheduled',
        started_at: new Date().toISOString(),
        creatives_synced: 0,
        brands_updated: 0,
        new_creatives: 0,
        new_brands: 0,
        total_api: 0,
      }),
    });

    const job = inserted?.[0];

    // Test SpyOwl creative API with a tiny fetch
    let triggered = false;
    let triggerError = null;
    try {
      const testRes = await fetch(`${SPYOWL_API}/creative/all?skip=0&limit=1&pageType=all&creativeType=all`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(10000),
      });
      if (testRes.ok) {
        triggered = true;
      } else {
        const text = await testRes.text().catch(() => '');
        triggerError = `SpyOwl creative API ${testRes.status}: ${text.slice(0, 200)}`;
      }
    } catch (e) {
      triggerError = `SpyOwl creative API error: ${e.message}`;
    }

    if (!triggered) {
      // Update job to failed
      await supaFetch(`/sync_runs?id=eq.${job?.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: triggerError || 'SpyOwl creative API unreachable',
        }),
      }).catch(() => {});
      return Response.json({ success: false, error: triggerError }, { status: 502 });
    }

    // Cron validated connectivity - mark job for manual trigger
    // Full scrape logic lives in POST /api/admin/scraper/trigger
    // Cron just confirms SpyOwl is alive and logs the check
    await supaFetch(`/sync_runs?id=eq.${job?.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'completed',
        finished_at: new Date().toISOString(),
        error_message: null,
      }),
    }).catch(() => {});

    return Response.json({
      success: true,
      job_id: job?.id,
      trigger_type: 'scheduled',
      spyowl_alive: true,
      message: 'SpyOwl connectivity verified — creative API is reachable',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
