import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

const SPYOWL_API = 'https://api.spyowl.icu';
const STALE_JOB_THRESHOLD_MS = 60 * 60 * 1000;
const BATCH_SIZE = 500;
const MAX_CREATIVES = 10000; // safety cap per run

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
  // If Prefer header includes return=minimal, body is empty — skip JSON parse
  const prefer = options.headers?.Prefer || '';
  if (prefer.includes('return=minimal')) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// ─── Update job progress in Supabase ───
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

// ─── Get SpyOwl cookie from Supabase settings ───
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
  return res.json(); // { creatives: [...], total: N, hasMore: bool }
}

// ─── Normalize offer name for brand grouping ───
function normalizeOffer(name) {
  if (!name) return 'unknown';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

// ─── Upsert creatives batch to Supabase ───
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

  // Upsert — on conflict update last_seen_at and scrape_count
  await supaFetch(
    '/creatives?on_conflict=id',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );

  return { newCount: rows.length };
}

// ─── Rebuild brand aggregates from creatives ───
async function rebuildBrands(jobId) {
  let brandsUpdated = 0;
  let newBrands = 0;
  const batchSize = 1000;
  let offset = 0;
  const brandMap = new Map();

  // Aggregate creatives by normalized_offer
  while (true) {
    const creatives = await supaFetch(
      `/creatives?select=normalized_offer,geo,celebrity_name,is_video,created_at&order=normalized_offer&offset=${offset}&limit=${batchSize}`
    );
    if (!creatives || creatives.length === 0) break;

    for (const c of creatives) {
      const key = c.normalized_offer || 'unknown';
      if (!brandMap.has(key)) {
        brandMap.set(key, {
          name: key,
          geos: new Set(),
          celebrities: new Set(),
          total: 0,
          videos: 0,
          photos: 0,
          dates: [],
        });
      }
      const b = brandMap.get(key);
      b.total++;
      if (c.geo) b.geos.add(c.geo);
      if (c.celebrity_name) {
        c.celebrity_name.split(',').map(n => n.trim()).filter(Boolean).forEach(n => b.celebrities.add(n));
      }
      if (c.is_video) b.videos++;
      else b.photos++;
      if (c.created_at) b.dates.push(new Date(c.created_at));
    }

    offset += batchSize;
    if (creatives.length < batchSize) break;
  }

  // Now upsert brands
  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 86400000);
  const fourteenDaysAgo = new Date(now - 14 * 86400000);

  const brandBatches = [];
  let currentBatch = [];

  for (const [name, b] of brandMap) {
    if (b.total < 2) continue; // skip single-creative "brands"

    const dates = b.dates.sort((a, d) => a - d);
    const firstSeen = dates[0] || now;
    const lastSeen = dates[dates.length - 1] || now;
    const lifespanDays = Math.max(1, Math.round((lastSeen - firstSeen) / 86400000));
    const velocity7d = dates.filter(d => d >= sevenDaysAgo).length;
    const velocityPrev7d = dates.filter(d => d >= fourteenDaysAgo && d < sevenDaysAgo).length;

    let velocityTrend = 'dead';
    if (velocity7d > 0) {
      if (velocityPrev7d === 0) velocityTrend = 'surging';
      else if (velocity7d >= 1.5 * velocityPrev7d) velocityTrend = 'surging';
      else if (velocity7d >= velocityPrev7d) velocityTrend = 'rising';
      else if (velocity7d >= 0.5 * velocityPrev7d) velocityTrend = 'stable';
      else velocityTrend = 'declining';
    }

    // Scam score (0-100)
    const scoreVolume = Math.min(b.total / 100, 25);
    const scoreGeo = Math.min(b.geos.size / 2, 25);
    const scoreCeleb = Math.min(b.celebrities.size / 10, 25);
    const scoreLongevity = Math.min(lifespanDays / 30, 15);
    const scoreVelocity = velocity7d > 0 ? 10 : 0;
    const scamScore = Math.round(scoreVolume + scoreGeo + scoreCeleb + scoreLongevity + scoreVelocity);

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

    currentBatch.push({
      slug,
      name,
      normalized_name: name,
      scam_score: Math.min(scamScore, 100),
      total_creatives: b.total,
      total_geos: b.geos.size,
      total_celebrities: b.celebrities.size,
      total_videos: b.videos,
      total_photos: b.photos,
      lifespan_days: lifespanDays,
      velocity_7d: velocity7d,
      velocity_trend: velocityTrend,
      celebrity_list: [...b.celebrities].slice(0, 50),
      geo_list: [...b.geos],
      language_list: [],
      status: velocity7d > 0 ? 'active' : lifespanDays > 30 ? 'inactive' : 'detected',
      first_seen_at: firstSeen.toISOString(),
      last_seen_at: lastSeen.toISOString(),
      updated_at: now.toISOString(),
    });

    if (currentBatch.length >= 200) {
      brandBatches.push(currentBatch);
      currentBatch = [];
    }
  }
  if (currentBatch.length) brandBatches.push(currentBatch);

  for (const batch of brandBatches) {
    try {
      await supaFetch('/scam_brands?on_conflict=slug', {
        method: 'POST',
        headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(batch),
      });
      brandsUpdated += batch.length;
    } catch (e) {
      console.error('[scraper] brand upsert failed:', e.message);
    }
  }

  return { brandsUpdated, newBrands, totalBrands: brandMap.size };
}

/**
 * POST /api/admin/scraper/trigger
 * Inline scraper: fetches creatives from SpyOwl, upserts to Supabase
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
      status: 'pending',
      trigger_type: 'manual',
      geo_filter: geoFilter,
      started_at: now,
      creatives_synced: 0,
      brands_updated: 0,
      new_creatives: 0,
      new_brands: 0,
      total_api: 0,
      progress: {
        phase: 'initializing',
        percent: 5,
        message: 'Creating scrape job...',
        steps: [{ id: 'init', label: 'Job created', status: 'done', ts: now }],
      },
    };
    const inserted = await supaFetch('/sync_runs?select=id,status,started_at,trigger_type,progress', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(jobData),
    });
    const job = inserted?.[0] || jobData;

    // Validate SpyOwl cookie
    const cookie = await getSpyOwlCookie();
    let spyowlReachable = false;
    if (cookie) {
      try {
        const res = await fetch(`${SPYOWL_API}/user/me`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(5000),
        });
        spyowlReachable = res.ok;
      } catch { spyowlReachable = false; }
    }

    if (!spyowlReachable) {
      const failSteps = [
        ...(job.progress?.steps || []),
        { id: 'cookie', label: cookie ? 'Cookie found' : 'No cookie', status: cookie ? 'done' : 'failed', ts: new Date().toISOString() },
        { id: 'fail', label: cookie ? 'SpyOwl API unreachable' : 'Missing cookie', status: 'failed', ts: new Date().toISOString() },
      ];
      await supaFetch(`/sync_runs?id=eq.${job.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'failed', finished_at: new Date().toISOString(),
          progress: { phase: 'failed', percent: 100, message: cookie ? 'SpyOwl unreachable' : 'No cookie configured', steps: failSteps },
          error_message: cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured',
        }),
      });
      return Response.json({ success: false, job_id: job.id, error: cookie ? 'SpyOwl unreachable' : 'No cookie configured' }, { status: 503 });
    }

    // Mark as running
    await supaFetch(`/sync_runs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'running' }),
    });

    await updateProgress(job.id, {
      phase: 'authenticating',
      percent: 10,
      message: 'SpyOwl authenticated \u2014 starting scrape...',
      steps: [
        ...(job.progress?.steps || []),
        { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
      ],
    });

    // ─── SCRAPE LOOP ───
    let skip = 0;
    let totalFetched = 0;
    let totalSynced = 0;
    let hasMore = true;
    let spyowlTotal = 0;
    let consecutiveErrors = 0;

    console.log(`[scraper] Starting scrape for job ${job.id}`);

    while (hasMore && totalFetched < MAX_CREATIVES) {
      try {
        const page = await fetchCreativePage(cookie, skip, BATCH_SIZE);
        const creatives = page.creatives || [];
        spyowlTotal = page.total || 0;
        hasMore = page.hasMore && creatives.length === BATCH_SIZE;

        if (creatives.length === 0) break;

        // Upsert to Supabase
        await upsertCreatives(creatives);
        totalFetched += creatives.length;
        totalSynced += creatives.length;
        skip += BATCH_SIZE;
        consecutiveErrors = 0; // reset on success

        // Update progress
        const pct = Math.min(10 + Math.round((totalFetched / Math.min(spyowlTotal, MAX_CREATIVES)) * 60), 70);
        await updateProgress(job.id, {
          phase: 'scanning',
          percent: pct,
          message: `Fetched ${totalFetched.toLocaleString()} of ${spyowlTotal.toLocaleString()} creatives...`,
          steps: [
            { id: 'init', label: 'Job created', status: 'done', ts: now },
            { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
            { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
            { id: 'scan', label: `${totalFetched.toLocaleString()} creatives fetched`, status: 'active', ts: new Date().toISOString() },
          ],
        });

        console.log(`[scraper] Batch ${skip / BATCH_SIZE}: ${creatives.length} creatives (total: ${totalFetched})`);

      } catch (e) {
        consecutiveErrors++;
        console.error(`[scraper] Batch error at skip=${skip}:`, e.message);
        skip += BATCH_SIZE;
        if (consecutiveErrors >= 3) {
          console.error(`[scraper] 3 consecutive failures, aborting`);
          break;
        }
      }
    }

    console.log(`[scraper] Scrape complete: ${totalFetched} creatives fetched`);

    // ─── BRAND REBUILD ───
    await updateProgress(job.id, {
      phase: 'processing',
      percent: 75,
      message: 'Rebuilding brand aggregates...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: now },
        { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: `${totalFetched.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    let brandResult = { brandsUpdated: 0, newBrands: 0, totalBrands: 0 };
    try {
      brandResult = await rebuildBrands(job.id);
      console.log(`[scraper] Brands rebuilt: ${brandResult.brandsUpdated} updated`);
    } catch (e) {
      console.error('[scraper] Brand rebuild failed:', e.message);
    }

    // ─── FINALIZE ───
    const finishedAt = new Date().toISOString();
    const finalProgress = {
      phase: 'done',
      percent: 100,
      message: `Done! ${totalFetched.toLocaleString()} creatives, ${brandResult.brandsUpdated} brands`,
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: now },
        { id: 'cookie', label: 'Cookie validated', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: `${totalFetched.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: `${brandResult.brandsUpdated} brands updated`, status: 'done', ts: new Date().toISOString() },
        { id: 'done', label: 'Scrape complete', status: 'done', ts: finishedAt },
      ],
    };

    await supaFetch(`/sync_runs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'completed',
        finished_at: finishedAt,
        creatives_synced: totalSynced,
        brands_updated: brandResult.brandsUpdated,
        new_creatives: totalFetched,
        total_api: spyowlTotal,
        progress: finalProgress,
      }),
    });

    return Response.json({
      success: true,
      job_id: job.id,
      status: 'completed',
      creatives_fetched: totalFetched,
      creatives_synced: totalSynced,
      brands_updated: brandResult.brandsUpdated,
      spyowl_total: spyowlTotal,
    });

  } catch (error) {
    console.error('[scraper] Fatal error:', error.message);
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
