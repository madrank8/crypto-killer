import { supaFetch, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase';

const SPYOWL_API = 'https://api.spyowl.icu';
const STALE_JOB_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 500;
const MAX_CREATIVES = Infinity; // No cap — fetch ALL creatives from SpyOwl
const SPYOWL_TIMEOUT_MS = 15000; // 15s per request
const PROGRESS_UPDATE_INTERVAL = 5; // Update progress every N batches

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

// ─── Fetch one page of creatives from SpyOwl ───
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

// ─── Fetch with retry (1 retry, exponential backoff) ───
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
// Returns { inserted, updated, total } from the RPC so the caller can track
// real insert/update ratios in sync_runs.
async function upsertCreatives(creatives) {
  if (!creatives.length) return { inserted: 0, updated: 0, total: 0 };

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
    // ─── SpyOwl URL + ad-copy fields (migration 005, Path B) ───
    // Emit empty string for missing fields rather than undefined because
    // the RPC uses NULLIF(x, '') to coerce them; either null or missing
    // jsonb keys would also work, but this keeps the payload symmetric
    // with the other `|| ''` fallbacks above.
    link_url:  c.linkUrl  || '',
    post_url:  c.postUrl  || '',
    fp_link:   c.fpLink   || '',
    link_text: c.linkText || '',
    main_text: c.mainText || '',
  }));

  const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_creatives`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${writeKey}`,
      apikey: writeKey,
    },
    body: JSON.stringify({ payload: rows }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upsert RPC failed ${res.status}: ${text}`);
  }

  // RPC returns { inserted, updated, total } as of migration 004
  const body = await res.json().catch(() => null);
  return {
    inserted: body?.inserted ?? 0,
    updated: body?.updated ?? rows.length,
    total: body?.total ?? rows.length,
  };
}

// ─── Rebuild brands via Supabase SQL function ───
// Returns { brands_inserted, brands_updated, brands_orphaned, total_brands } from migration 004.
async function rebuildBrands() {
  const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rebuild_brands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${writeKey}`,
      apikey: writeKey,
    },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Brand rebuild RPC failed ${res.status}: ${text}`);
  }
  const body = await res.json().catch(() => ({}));
  return {
    brands_inserted: body?.brands_inserted ?? 0,
    brands_updated: body?.brands_updated ?? 0,
    brands_orphaned: body?.brands_orphaned ?? 0,
    total_brands: body?.total_brands ?? 0,
    timestamp: body?.timestamp ?? null,
  };
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
    console.error('[scraper] progress update failed:', e.message);
  }
}

// ─── Update job counters + progress in a single DB call ───
async function updateJobState(jobId, counters, progress) {
  try {
    await supaFetch(`/sync_runs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...counters, progress }),
    });
  } catch (e) {
    console.error('[scraper] job state update failed:', e.message);
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
 * Run the scrape loop with pipelined fetch + upsert.
 *
 * Pipeline pattern: while upserting batch N, prefetch batch N+1.
 * This overlaps network I/O and cuts total time by ~40-50%.
 *
 * @param {Object} options
 * @param {string} options.jobId - The sync_runs job ID
 * @param {string} options.cookie - SpyOwl cookie string
 * @param {number} [options.startSkip=0] - Skip offset to resume from
 * @param {number} [options.maxBatches=Infinity] - Max batches per invocation
 * @param {boolean} [options.skipBrandRebuild=false] - Skip brand rebuild
 * @returns {Object}
 */
async function runScrapeLoop({
  jobId,
  cookie,
  startSkip = 0,
  maxBatches = Infinity,
  skipBrandRebuild = false,
}) {
  const loopStartTime = new Date().toISOString();
  let skip = startSkip;
  let totalFetched = 0;
  let totalSynced = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let hasMore = true;
  let spyowlTotal = 0;
  let consecutiveErrors = 0;
  let batchCount = 0;
  const errors = [];

  console.log(`[scraper] Starting scrape for job ${jobId} at skip=${startSkip}, maxBatches=${maxBatches}`);

  // Mark running
  await supaFetch(`/sync_runs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'running' }),
  }).catch(() => {});

  // ─── PIPELINED SCRAPE LOOP ───
  let nextFetchPromise = null;

  while (hasMore && batchCount < maxBatches) {
    let page;

    // Fetch current batch (either from prefetch or fresh)
    try {
      if (nextFetchPromise) {
        page = await nextFetchPromise;
        nextFetchPromise = null;
      } else {
        page = await fetchWithRetry(cookie, skip, BATCH_SIZE);
      }
    } catch (e) {
      page = null;
      nextFetchPromise = null;
      consecutiveErrors++;
      errors.push(`skip=${skip}: ${e.message}`);
      console.error(`[scraper] Batch error at skip=${skip}:`, e.message);

      if (consecutiveErrors >= 3) {
        console.error('[scraper] 3 consecutive failures, aborting');
        break;
      }

      skip += BATCH_SIZE;
      batchCount++;
      continue;
    }

    if (!page) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) break;
      skip += BATCH_SIZE;
      batchCount++;
      continue;
    }

    const creatives = page.creatives || [];
    spyowlTotal = page.total || 0;
    hasMore = page.hasMore && creatives.length === BATCH_SIZE;

    if (creatives.length === 0) {
      hasMore = false;
      break;
    }

    // ── Pipeline: start prefetching next batch while we upsert current ──
    const nextSkip = skip + BATCH_SIZE;
    const shouldPrefetch = hasMore && (batchCount + 1) < maxBatches;

    if (shouldPrefetch) {
      nextFetchPromise = fetchWithRetry(cookie, nextSkip, BATCH_SIZE).catch(e => {
        // Don't throw — let the main loop handle it
        return null;
      });
    }

    // Upsert current batch
    try {
      const upsertResult = await upsertCreatives(creatives);
      totalInserted += upsertResult.inserted || 0;
      totalUpdated += upsertResult.updated || 0;
    } catch (e) {
      errors.push(`upsert at skip=${skip}: ${e.message}`);
      console.error(`[scraper] Upsert error at skip=${skip}:`, e.message);
    }

    totalFetched += creatives.length;
    totalSynced += creatives.length;
    skip += BATCH_SIZE;
    batchCount++;
    consecutiveErrors = 0;

    // ── Update progress periodically (every N batches) ──
    if (batchCount % PROGRESS_UPDATE_INTERVAL === 0 || !hasMore) {
      const globalFetched = startSkip + totalFetched;
      const displayTotal = spyowlTotal || globalFetched;
      const pct = Math.min(10 + Math.round((globalFetched / Math.max(displayTotal, 1)) * 70), 80);

      await updateJobState(jobId, {
        creatives_synced: globalFetched,
        new_creatives: totalInserted,
        updated_creatives: totalUpdated,
        total_api: spyowlTotal,
      }, {
        phase: 'scanning',
        percent: pct,
        message: `Fetched ${globalFetched.toLocaleString()} of ${displayTotal.toLocaleString()} creatives...`,
        steps: [
          { id: 'init', label: 'Job created', status: 'done', ts: loopStartTime },
          { id: 'auth', label: 'Authenticated', status: 'done', ts: loopStartTime },
          { id: 'scan', label: `${globalFetched.toLocaleString()} creatives fetched`, status: 'active', ts: new Date().toISOString() },
        ],
      });

      console.log(`[scraper] Progress: ${globalFetched}/${displayTotal} (${pct}%) — batch ${batchCount}`);
    }
  }

  const abortedEarly = consecutiveErrors >= 3;
  const scrapeComplete = !hasMore || abortedEarly;
  console.log(`[scraper] Chunk done: ${totalFetched} (total: ${startSkip + totalFetched}), hasMore=${hasMore}, aborted=${abortedEarly}`);

  // ─── BRAND REBUILD (only if NOT skipped and scrape is done) ───
  let brandsUpdated = 0;
  let brandError = null;

  if (!skipBrandRebuild && scrapeComplete) {
    const globalTotal = startSkip + totalFetched;

    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: 'Rebuilding brand aggregates...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: loopStartTime },
        { id: 'auth', label: 'Authenticated', status: 'done', ts: loopStartTime },
        { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
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

  // ─── FINALIZE (only when scrape is complete AND brand rebuild was NOT skipped) ───
  if (scrapeComplete && !skipBrandRebuild) {
    const globalTotal = startSkip + totalFetched;
    const finishedAt = new Date().toISOString();

    let finalStatus = 'completed';
    let errorMessage = null;

    if (globalTotal === 0) {
      finalStatus = 'failed';
      errorMessage = 'No creatives fetched';
    } else if (abortedEarly || brandError) {
      finalStatus = 'completed';
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
        creatives_synced: globalTotal,
        brands_updated: brandsUpdated,
        new_creatives: totalInserted,
        updated_creatives: totalUpdated,
        total_api: spyowlTotal,
        error_message: errorMessage,
        progress: {
          phase: 'done',
          percent: 100,
          message: errorMessage
            ? `Done with warnings: ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`
            : `Done! ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`,
          steps: [
            { id: 'init', label: 'Job created', status: 'done', ts: loopStartTime },
            { id: 'auth', label: 'Authenticated', status: 'done', ts: loopStartTime },
            { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands updated`, status: brandError ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'done', label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
          ],
        },
      }),
    }).catch(e => console.error('[scraper] finalize failed:', e.message));
  }

  return {
    totalFetched,
    totalSynced,
    totalInserted,
    totalUpdated,
    hasMore: hasMore && !abortedEarly,
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
  updateJobState,
  createJob,
  failJob,
  getActiveJob,
  runScrapeLoop,
};
