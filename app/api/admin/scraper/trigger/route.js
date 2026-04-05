import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

const SPYOWL_API = 'https://api.spyowl.icu';
const STALE_JOB_THRESHOLD_MS = 60 * 60 * 1000;
const BATCH_SIZE = 500;
const MAX_CREATIVES = 50000;

// ─── Supabase helper ───
async function supaFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...(options.headers || {}),
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, { method: options.method || 'GET', headers, body: options.body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (options.method === 'HEAD') return null;
  const prefer = options.headers?.Prefer || '';
  if (prefer.includes('return=minimal')) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// ─── Update job progress ───
async function updateProgress(jobId, progress) {
  await supaFetch(`/sync_runs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ progress }),
  }).catch(e => console.error('[scraper] progress update failed:', e.message));
}

// ─── Cleanup stale jobs ───
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
    console.error('[scraper] stale cleanup failed:', e.message);
  }
}

// ─── Get SpyOwl cookie ───
async function getSpyOwlCookie() {
  try {
    const rows = await supaFetch('/settings?key=eq.spyowl_cookie&select=value');
    const token = rows?.[0]?.value?.trim() || '';
    if (!token) return '';
    return token.includes('=') ? token : `__Secure-spyowl.session_token=${token}`;
  } catch { return ''; }
}

// ─── Fetch one page of creatives from SpyOwl ───
async function fetchCreativePage(cookie, skip, limit) {
  const url = `${SPYOWL_API}/creative/all?skip=${skip}&limit=${limit}&pageType=all&creativeType=all`;
  const res = await fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SpyOwl ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Normalize offer name ───
function normalizeOffer(name) {
  if (!name) return 'unknown';
  return name.trim().replace(/\s+/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/^(the|a|an)\s+/i, '').trim();
}

// ─── Upsert creatives batch ───
async function upsertCreatives(creatives) {
  if (!creatives.length) return { newCount: 0 };
  const rows = creatives.map(c => ({
    id: c._id,
    offer_name: c.offerName || '',
    normalized_offer: normalizeOffer(c.offerName),
    celebrity_name: c.celebrityName || '',
    geo: c.geo || '',
    geo_region_id: c.geoRegionId || '',
    is_video: !!c.isVideo,
    land_language: c.landLanguage || '',
    is_favorite: !!c.isFavorite,
    created_at: c.createdAt || new Date().toISOString(),
    first_seen_at: c.createdAt || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    scrape_count: 1,
    synced_at: new Date().toISOString(),
  }));
  await supaFetch('/creatives?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  return { newCount: rows.length };
}

// ─── Rebuild brands via Supabase SQL function ───
async function rebuildBrands() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rebuild_brands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Brand rebuild RPC failed ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * POST /api/admin/scraper/trigger
 * Inline scraper: fetches creatives from SpyOwl, upserts to Supabase, rebuilds brands via SQL
 */
export async function POST(request) {
  try {
    verifyAdmin(request);
    await cleanupStaleJobs();

    const body = await request.json().catch(() => ({}));
    const geoFilter = body.geo_filter || null;

    // Check for existing running job
    const pending = await supaFetch(
      '/sync_runs?status=in.("pending","running")&select=id,status,started_at&order=started_at.desc&limit=1'
    );
    if (pending && pending.length > 0) {
      return Response.json({ error: 'A scrape is already in progress', existing_job: pending[0] }, { status: 409 });
    }

    // Create the job
    const now = new Date().toISOString();
    const jobData = {
      status: 'pending', trigger_type: 'manual', geo_filter: geoFilter, started_at: now,
      creatives_synced: 0, brands_updated: 0, new_creatives: 0, new_brands: 0, total_api: 0,
      progress: { phase: 'initializing', percent: 5, message: 'Creating scrape job...',
        steps: [{ id: 'init', label: 'Job created', status: 'done', ts: now }] },
    };
    const inserted = await supaFetch('/sync_runs?select=id,status,started_at,trigger_type,progress', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(jobData),
    });
    const job = inserted?.[0] || jobData;

    // Validate SpyOwl cookie
    const cookie = await getSpyOwlCookie();
    let spyowlReachable = false;
    if (cookie) {
      try {
        const res = await fetch(`${SPYOWL_API}/user/me`, {
          headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000),
        });
        spyowlReachable = res.ok;
      } catch { spyowlReachable = false; }
    }

    if (!spyowlReachable) {
      await supaFetch(`/sync_runs?id=eq.${job.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed', finished_at: new Date().toISOString(),
          progress: { phase: 'failed', percent: 100,
            message: cookie ? 'SpyOwl unreachable' : 'No cookie configured',
            steps: [...(job.progress?.steps || []),
              { id: 'fail', label: cookie ? 'SpyOwl unreachable' : 'No cookie', status: 'failed', ts: new Date().toISOString() }] },
          error_message: cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured',
        }),
      });
      return Response.json({ success: false, job_id: job.id, error: cookie ? 'SpyOwl unreachable' : 'No cookie' }, { status: 503 });
    }

    // Mark running
    await supaFetch(`/sync_runs?id=eq.${job.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running' }),
    });
    await updateProgress(job.id, {
      phase: 'authenticating', percent: 10, message: 'SpyOwl authenticated \u2014 starting scrape...',
      steps: [...(job.progress?.steps || []),
        { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() }],
    });

    // ─── SCRAPE LOOP ───
    let skip = 0, totalFetched = 0, totalSynced = 0, hasMore = true, spyowlTotal = 0, consecutiveErrors = 0;
    console.log(`[scraper] Starting scrape for job ${job.id}`);

    while (hasMore && totalFetched < MAX_CREATIVES) {
      try {
        const page = await fetchCreativePage(cookie, skip, BATCH_SIZE);
        const creatives = page.creatives || [];
        spyowlTotal = page.total || 0;
        hasMore = page.hasMore && creatives.length === BATCH_SIZE;
        if (creatives.length === 0) break;

        await upsertCreatives(creatives);
        totalFetched += creatives.length;
        totalSynced += creatives.length;
        skip += BATCH_SIZE;
        consecutiveErrors = 0;

        const pct = Math.min(10 + Math.round((totalFetched / Math.min(spyowlTotal, MAX_CREATIVES)) * 70), 80);
        await updateProgress(job.id, {
          phase: 'scanning', percent: pct,
          message: `Fetched ${totalFetched.toLocaleString()} of ${Math.min(spyowlTotal, MAX_CREATIVES).toLocaleString()} creatives...`,
          steps: [
            { id: 'init', label: 'Job created', status: 'done', ts: now },
            { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
            { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
            { id: 'scan', label: `${totalFetched.toLocaleString()} creatives fetched`, status: 'active', ts: new Date().toISOString() },
          ],
        });
        console.log(`[scraper] Batch ${skip / BATCH_SIZE}: ${creatives.length} (total: ${totalFetched})`);
      } catch (e) {
        consecutiveErrors++;
        console.error(`[scraper] Batch error at skip=${skip}:`, e.message);
        skip += BATCH_SIZE;
        if (consecutiveErrors >= 3) { console.error('[scraper] 3 consecutive failures, aborting'); break; }
      }
    }
    console.log(`[scraper] Scrape done: ${totalFetched} creatives`);

    // ─── BRAND REBUILD (SQL function — runs server-side in Postgres) ───
    await updateProgress(job.id, {
      phase: 'processing', percent: 85, message: 'Rebuilding brand aggregates...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: now },
        { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: `${totalFetched.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    let brandsUpdated = 0;
    try {
      const brandResult = await rebuildBrands();
      brandsUpdated = brandResult?.brands_updated || 0;
      console.log(`[scraper] Brands rebuilt: ${brandsUpdated}`);
    } catch (e) {
      console.error('[scraper] Brand rebuild failed:', e.message);
    }

    // ─── FINALIZE ───
    const finishedAt = new Date().toISOString();
    await supaFetch(`/sync_runs?id=eq.${job.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'completed', finished_at: finishedAt,
        creatives_synced: totalSynced, brands_updated: brandsUpdated,
        new_creatives: totalFetched, total_api: spyowlTotal,
        progress: {
          phase: 'done', percent: 100,
          message: `Done! ${totalFetched.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`,
          steps: [
            { id: 'init', label: 'Job created', status: 'done', ts: now },
            { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
            { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
            { id: 'scan', label: `${totalFetched.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
            { id: 'brands', label: `${brandsUpdated.toLocaleString()} brands updated`, status: 'done', ts: new Date().toISOString() },
            { id: 'done', label: 'Scrape complete', status: 'done', ts: finishedAt },
          ],
        },
      }),
    });

    return Response.json({
      success: true, job_id: job.id, status: 'completed',
      creatives_fetched: totalFetched, creatives_synced: totalSynced,
      brands_updated: brandsUpdated, spyowl_total: spyowlTotal,
    });
  } catch (error) {
    console.error('[scraper] Fatal error:', error.message);
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
