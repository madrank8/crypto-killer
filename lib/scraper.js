import { supaFetch, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const SPYOWL_API = 'https://api.spyowl.icu';
const STALE_JOB_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 500;
const MAX_CREATIVES = 100000;
const SPYOWL_TIMEOUT_MS = 15000; // 15s per request (down from 30s to allow retry)

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

// ─── Get SpyOwl cookie from settings ───
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

// ─── Validate SpyOwl cookie ───
async function validateSpyOwl(cookie) {
  if (!cookie) return false;
  try {
    const res = await fetch(`${SPYOWL_API}/user/me`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Fetch one page of creatives from SpyOwl (with retry) ───
async function fetchCreativePage(cookie, skip, limit) {
  const url = `${SPYOWL_API}/creative/all?skip=${skip}&limit=${limit}&pageType=all&creativeType=all`;
  const res = await fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(SPYOWL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SpyOwl ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchWithRetry(cookie, skip, limit, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchCreativePage(cookie, skip, limit);
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = 2000 * (attempt + 1);
      console.log(`[scraper] Retry ${attempt + 1} for skip=${skip} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Normalize offer name ───
function normalizeOffer(name) {
  if (!name) return 'unknown';
  return name.trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

// ─── Upsert creatives via RPC (increments scrape_count properly) ───
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
    synced_at: new Date().toISOString(),
  }));

  // Call RPC function that properly handles ON CONFLICT with scrape_count increment
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_creatives`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ payload: rows }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upsert RPC failed ${res.status}: ${text}`);
  }

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

// ─── Update job progress ───
async function updateProgress(jobId, progress) {
  try {
    await supaFetch(`/sync_runs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ progress }),
    });
  } catch (e) {
    console.error('[scraper] progress update failed:', e.message, e.stack);
  }
}

// ─── Create a new scrape job ───
async function createJob(triggerType, geoFilter = null) {
  const now = new Date().toISOString();
  const jobData = {
    status: 'pending',
    trigger_type: triggerType,
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

  return inserted?.[0] || { ...jobData, id: null };
}

// ─── Fail a job ───
async function failJob(jobId, message, steps = []) {
  await supaFetch(`/sync_runs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: message,
      progress: {
        phase: 'failed',
        percent: 100,
        message,
        steps: [
          ...steps,
          { id: 'fail', label: message, status: 'failed', ts: new Date().toISOString() },
        ],
      },
    }),
  }).catch(e => console.error('[scraper] failJob update failed:', e.message));
}

// ─── Check for existing running job ───
async function getActiveJob() {
  const pending = await supaFetch(
    '/sync_runs?status=in.("pending","running")&select=id,status,started_at&order=started_at.desc&limit=1'
  );
  return pending?.[0] || null;
}

/**
 * Run the scrape loop.
 * Processes creatives from SpyOwl in batches, upserts to Supabase, rebuilds brands.
 *
 * @param {Object} options
 * @param {string} options.jobId - The sync_runs job ID
 * @param {string} options.cookie - SpyOwl cookie string
 * @param {number} [options.startSkip=0] - Skip offset to resume from
 * @param {number} [options.maxBatches=Infinity] - Max batches per invocation (for chunking)
 * @param {boolean} [options.skipBrandRebuild=false] - Skip brand rebuild (for mid-chain calls)
 * @returns {Object} { totalFetched, totalSynced, hasMore, nextSkip, spyowlTotal, abortedEarly, errors }
 */
async function runScrapeLoop({
  jobId,
  cookie,
  startSkip = 0,
  maxBatches = Infinity,
  skipBrandRebuild = false,
}) {
  const now = new Date().toISOString();
  let skip = startSkip;
  let totalFetched = 0;
  let totalSynced = 0;
  let hasMore = true;
  let spyowlTotal = 0;
  let consecutiveErrors = 0;
  let batchCount = 0;
  const errors = [];

  console.log(`[scraper] Starting scrape for job ${jobId} at skip=${startSkip}`);

  // Mark running
  await supaFetch(`/sync_runs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'running' }),
  }).catch(() => {});

  // ─── SCRAPE LOOP ───
  while (hasMore && (startSkip + totalFetched) < MAX_CREATIVES && batchCount < maxBatches) {
    try {
      const page = await fetchWithRetry(cookie, skip, BATCH_SIZE);
      const creatives = page.creatives || [];
      spyowlTotal = page.total || 0;
      hasMore = page.hasMore && creatives.length === BATCH_SIZE;
      if (creatives.length === 0) { hasMore = false; break; }

      await upsertCreatives(creatives);
      totalFetched += creatives.length;
      totalSynced += creatives.length;
      skip += BATCH_SIZE;
      batchCount++;
      consecutiveErrors = 0;

      const globalFetched = startSkip + totalFetched;
      const pct = Math.min(10 + Math.round((globalFetched / Math.min(spyowlTotal || 1, MAX_CREATIVES)) * 70), 80);
      await updateProgress(jobId, {
        phase: 'scanning',
        percent: pct,
        message: `Fetched ${globalFetched.toLocaleString()} of ${Math.min(spyowlTotal, MAX_CREATIVES).toLocaleString()} creatives...`,
        steps: [
          { id: 'init', label: 'Job created', status: 'done', ts: now },
          { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: now },
          { id: 'scan', label: `${globalFetched.toLocaleString()} creatives fetched`, status: 'active', ts: new Date().toISOString() },
        ],
      });
      console.log(`[scraper] Batch ${batchCount}: ${creatives.length} (total: ${globalFetched})`);
    } catch (e) {
      consecutiveErrors++;
      errors.push(`skip=${skip}: ${e.message}`);
      console.error(`[scraper] Batch error at skip=${skip}:`, e.message);
      skip += BATCH_SIZE;
      batchCount++;
      if (consecutiveErrors >= 3) {
        console.error('[scraper] 3 consecutive failures, aborting');
        break;
      }
    }
  }

  const abortedEarly = consecutiveErrors >= 3;
  const reachedCap = (startSkip + totalFetched) >= MAX_CREATIVES;
  const scrapeComplete = !hasMore || reachedCap || abortedEarly;
  console.log(`[scraper] Scrape chunk done: ${totalFetched} creatives, aborted=${abortedEarly}, hasMore=${hasMore}, reachedCap=${reachedCap}`);

  // ─── BRAND REBUILD ───
  let brandsUpdated = 0;
  let brandError = null;

  if (!skipBrandRebuild && scrapeComplete) {
    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: 'Rebuilding brand aggregates...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: now },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: now },
        { id: 'scan', label: `${(startSkip + totalFetched).toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    try {
      const result = await rebuildBrands();
      brandsUpdated = result?.brands_updated || 0;
      console.log(`[scraper] Brands rebuilt: ${brandsUpdated}`);
    } catch (e) {
      brandError = e.message;
      console.error('[scraper] Brand rebuild failed:', e.message);
    }
  }

  // ─── FINALIZE (when scrape is done: no more data, hit cap, or aborted) ───
  if (scrapeComplete) {
    const globalTotal = startSkip + totalFetched;
    const finishedAt = new Date().toISOString();

    // Determine actual status
    let finalStatus = 'completed';
    let errorMessage = null;

    if (globalTotal === 0) {
      finalStatus = 'failed';
      errorMessage = 'No creatives fetched';
    } else if (abortedEarly || brandError) {
      finalStatus = 'completed'; // still completed, but with error_message for UI warning
      const parts = [];
      if (abortedEarly) parts.push(`Aborted after 3 consecutive batch failures at offset ${skip}`);
      if (brandError) parts.push(`Brand rebuild failed: ${brandError}`);
      if (errors.length > 0) parts.push(`${errors.length} batch error(s)`);
      errorMessage = parts.join('. ');
    }

    await supaFetch(`/sync_runs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: finalStatus,
        finished_at: finishedAt,
        creatives_synced: totalSynced,
        brands_updated: brandsUpdated,
        new_creatives: globalTotal,
        total_api: spyowlTotal,
        error_message: errorMessage,
        progress: {
          phase: 'done',
          percent: 100,
          message: errorMessage
            ? `Done with warnings: ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`
            : `Done! ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`,
          steps: [
            { id: 'init', label: 'Job created', status: 'done', ts: now },
            { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: now },
            { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'brands', label: brandError ? `Brand rebuild failed` : `${brandsUpdated.toLocaleString()} brands updated`, status: brandError ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'done', label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
          ],
        },
      }),
    }).catch(e => console.error('[scraper] finalize failed:', e.message));
  }

  return {
    totalFetched,
    totalSynced,
    hasMore: hasMore && !reachedCap && !abortedEarly,
    nextSkip: skip,
    spyowlTotal,
    brandsUpdated,
    abortedEarly,
    brandError,
    errors,
  };
}

export {
  SPYOWL_API,
  BATCH_SIZE,
  MAX_CREATIVES,
  STALE_JOB_THRESHOLD_MS,
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  fetchCreativePage,
  fetchWithRetry,
  normalizeOffer,
  upsertCreatives,
  rebuildBrands,
  updateProgress,
  createJob,
  failJob,
  getActiveJob,
  runScrapeLoop,
};
