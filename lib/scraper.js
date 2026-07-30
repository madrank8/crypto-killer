import { supaFetch, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase';
import { normalizeOffer, buildCleanBrandPrefixes, extractCelebrity } from '@/lib/offer-extract.mjs';

const SPYOWL_API = 'https://api.spyowl.icu';

// ─── Stale-job detection thresholds ───
// A job is reaped if its heartbeat is older than HEARTBEAT_STALE_MS, OR if it
// was started more than STARTED_STALE_MS ago (legacy backstop for jobs that
// have no heartbeat field — e.g. created by an old deploy mid-rollout).
//
// HEARTBEAT_STALE_MS = 180s gives plenty of margin over normal chunk activity
// (~7.5s between heartbeats during scanning, ~30s during brand rebuild) but
// is well below Vercel's 300s function ceiling — a missed heartbeat past 180s
// means the lambda is definitely dead.
const HEARTBEAT_STALE_MS = 180 * 1000;     // 3 min
const STARTED_STALE_MS   = 6 * 60 * 1000;  // 6 min — was 1hr; lambda max is 5min

// ─── Chunking ───
// Each lambda invocation runs at most MAX_BATCHES_PER_CHUNK batches, then
// chains to /api/admin/scraper/continue for the next chunk. With BATCH_SIZE=500
// that's 30k creatives per chunk at ~1.5-2s per batch = ~90-120s wallclock,
// well under the 300s function ceiling. A full 80k catalog completes in 3
// chunks across 3 lambda invocations, total wallclock ~5 minutes.
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_CHUNK = 60;
const MAX_CREATIVES = Infinity;
const SPYOWL_TIMEOUT_MS = 15000;
const PROGRESS_UPDATE_INTERVAL = 5;

// ─── Error-handling tunables (Tier 1 reliability, 2026-05-03) ───
// Previously the loop aborted on 3 consecutive batch failures, which made the
// scraper hair-trigger to transient SpyOwl flakes (a single 502 + two retries
// that happened to also fail = whole job marked completed-with-warnings).
// New rule: abort only when we hit MAX_CONSECUTIVE_ERRORS *and* haven't made
// any progress for ABORT_AFTER_NO_PROGRESS_MS. A storm of errors that
// resolves quickly stops being a job-killer.
const MAX_CONSECUTIVE_ERRORS = 5;
const ABORT_AFTER_NO_PROGRESS_MS = 60 * 1000;

// fetchWithRetry tunables. 1 → 3 retries with exponential backoff + jitter.
// 429s honor the server's Retry-After header. 401/403s propagate immediately
// (no retry — auth failures don't get fixed by waiting).
const FETCH_MAX_RETRIES = 3;
const FETCH_BACKOFF_BASE_MS = 1000;
const FETCH_BACKOFF_JITTER_MS = 500;

// Brand rebuild RPC retry. Brand rebuild is a heavy Postgres function that
// occasionally fails under DB contention; retrying is almost always safe
// (it's idempotent — derives from the creatives snapshot).
const BRAND_REBUILD_MAX_RETRIES = 2;
const BRAND_REBUILD_BACKOFF_MS = [5000, 15000];

// Window during which a previously-failed job is still considered resumable.
const RESUMABLE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Internal helpers ───

function nowIso() {
  return new Date().toISOString();
}

function selfBaseUrl() {
  // Prefer the canonical production URL so the chain target is stable across
  // deployments. Fall back to the per-deployment URL, then to the known
  // public hostname as a last resort.
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const dep  = process.env.VERCEL_URL;
  const host = prod || dep || 'crypto-killer.vercel.app';
  return host.startsWith('http') ? host : `https://${host}`;
}

// ─── Cleanup stale jobs ───
// Heartbeat-based detection: if progress.last_heartbeat is older than 180s,
// or started_at is older than 6 minutes, the job is dead. Crucially we
// PRESERVE progress (which contains next_skip) so the job can be resumed.
//
// IMPORTANT — debounced. The admin scraper page polls /scraper/history every
// 3 seconds and runs an ActiveJobPanel tick every 1 second; each call used
// to trigger an unconditional PATCH on sync_runs filtered by the jsonb
// expression `progress->>'last_heartbeat'`. With no supporting index that's
// a sequential scan + row locks per call, which exhausted the PostgREST
// connection pool and caused fleet-wide 522 timeouts (incident 2026-04-27).
//
// Heartbeats arrive every ~7s during scanning, so reaping at most once every
// CLEANUP_DEBOUNCE_MS is plenty for stale-job detection while removing the
// load amplifier on the database. The debounce lives in lambda memory; cold
// starts will run cleanup once and that's fine.
const CLEANUP_DEBOUNCE_MS = 30 * 1000;
let lastCleanupAt = 0;

async function cleanupStaleJobs({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCleanupAt < CLEANUP_DEBOUNCE_MS) {
    return; // debounced — another caller ran cleanup recently
  }
  lastCleanupAt = now;

  const heartbeatCutoff = new Date(now - HEARTBEAT_STALE_MS).toISOString();
  const startedCutoff   = new Date(now - STARTED_STALE_MS).toISOString();

  // PostgREST lets us OR two conditions via the `or=()` query param. The jsonb
  // path filter `progress->>last_heartbeat.lt.X` compares the extracted text
  // to X — ISO-8601 UTC timestamps sort lexicographically so this is correct.
  const filter =
    `status=in.("pending","running")` +
    `&or=(started_at.lt.${startedCutoff},progress->>last_heartbeat.lt.${heartbeatCutoff})`;

  try {
    await supaFetch(`/sync_runs?${filter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'failed',
        finished_at: nowIso(),
        error_message: 'Auto-failed: heartbeat stale (lambda likely killed by timeout). Resumable from progress.next_skip.',
      }),
    });
  } catch (e) {
    // Don't poison the debounce on failure — let the next eligible call retry.
    lastCleanupAt = 0;
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
// Encodes 429 Retry-After into the error message so fetchWithRetry can honor
// it. 401/403 are encoded with a recognizable prefix so the caller can
// short-circuit retries (auth failures don't get fixed by waiting).
async function fetchCreativePage(cookie, skip, limit) {
  const url = `${SPYOWL_API}/creative/all?skip=${skip}&limit=${limit}&pageType=all&creativeType=all`;
  const res = await fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(SPYOWL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') || '';
      throw new Error(`SpyOwl 429 [Retry-After:${retryAfter}]: ${text.slice(0, 200)}`);
    }
    throw new Error(`SpyOwl ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Fetch with retry — 3 retries, exponential backoff + jitter ───
// Retry policy:
//   - 401 / 403 → propagate immediately (auth failure; caller marks job
//     "cookie expired" rather than burning the abort budget on hopeless retries)
//   - 429 → honor server's Retry-After header (seconds), fall back to base
//     backoff if header is missing/unparseable
//   - other errors → exponential backoff with jitter
//     attempt 0 fail → wait ~1s + jitter
//     attempt 1 fail → wait ~2s + jitter
//     attempt 2 fail → wait ~4s + jitter
//     attempt 3 → final, throw
function isAuthFailureMessage(msg) {
  return /^SpyOwl 40[13](?:\b| )/.test(String(msg || ''));
}

async function fetchWithRetry(cookie, skip, limit, retries = FETCH_MAX_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchCreativePage(cookie, skip, limit);
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || '');

      // Auth failures: stop retrying, propagate so caller can fail-clean.
      if (isAuthFailureMessage(msg)) throw e;

      // Out of retries.
      if (attempt === retries) break;

      // Honor Retry-After on 429.
      let delay;
      const ra = msg.match(/Retry-After:(\d+)/);
      if (ra) {
        delay = Math.min(parseInt(ra[1], 10) * 1000, 30000);
      } else {
        delay = Math.pow(2, attempt) * FETCH_BACKOFF_BASE_MS + Math.random() * FETCH_BACKOFF_JITTER_MS;
      }

      console.log(
        `[scraper] Retry ${attempt + 1}/${retries} for skip=${skip} after ${Math.round(delay)}ms ` +
        `(${msg.slice(0, 80)})`
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// normalizeOffer is now imported from @/lib/offer-extract.mjs — single source
// of truth shared with backfill scripts.

// ─── Load brand-prefix dictionary for celebrity extraction ───
// Fetches scam_brands.normalized_name (paginated) and returns a clean,
// length-desc-sorted prefix list. Called once per runScrapeLoop invocation
// (i.e., once per chunk) so the per-row hot path stays in-memory only.
//
// On failure we return an empty list rather than throwing — the scraper
// then degrades to the pre-fix behavior of trusting only SpyOwl's
// celebrityName field. Better to keep ingesting than to abort a 80k-row
// scrape because of a transient Supabase blip.
async function loadBrandPrefixes() {
  try {
    const all = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const page = await supaFetch(
        `/scam_brands?select=normalized_name&limit=${PAGE}&offset=${offset}&order=normalized_name.asc`
      );
      if (!Array.isArray(page) || page.length === 0) break;
      for (const r of page) {
        if (r && r.normalized_name) all.push(r.normalized_name);
      }
      if (page.length < PAGE) break;
      offset += page.length;
    }
    const clean = buildCleanBrandPrefixes(all);
    console.log(`[scraper] Loaded ${all.length} brand prefixes (${clean.length} clean after pollution filter)`);
    return clean;
  } catch (e) {
    console.error(`[scraper] loadBrandPrefixes failed — degrading to empty prefix list: ${e.message}`);
    return [];
  }
}

// ─── Upsert creatives via RPC ───
async function upsertCreatives(creatives, brandPrefixes = []) {
  if (!creatives.length) return { inserted: 0, updated: 0, total: 0 };

  const rows = creatives.map(c => ({
    id: c._id,
    offer_name: c.offerName || '',
    normalized_offer: normalizeOffer(c.offerName),
    celebrity_name: c.celebrityName || extractCelebrity(c.offerName, brandPrefixes) || '',
    geo: c.geo || '',
    geo_region_id: c.geoRegionId || '',
    is_video: !!c.isVideo,
    land_language: c.landLanguage || '',
    is_favorite: !!c.isFavorite,
    created_at: c.createdAt || nowIso(),
    first_seen_at: c.createdAt || nowIso(),
    last_seen_at: nowIso(),
    synced_at: nowIso(),
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

  const body = await res.json().catch(() => null);
  return {
    inserted: body?.inserted ?? 0,
    updated:  body?.updated  ?? rows.length,
    total:    body?.total    ?? rows.length,
  };
}

// ─── Rebuild brands (one attempt) ───
async function rebuildBrandsOnce() {
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
    brands_updated:  body?.brands_updated  ?? 0,
    brands_orphaned: body?.brands_orphaned ?? 0,
    total_brands:    body?.total_brands    ?? 0,
    timestamp:       body?.timestamp       ?? null,
  };
}

// ─── Rebuild brands with retry ───
// The brand rebuild RPC is a heavy Postgres aggregation that occasionally
// fails under DB contention (concurrent scraper writes, vacuum, etc.). It's
// idempotent — derived purely from the creatives snapshot — so retrying is
// always safe. Two retries with 5s + 15s backoff covers the typical DB
// contention window.
async function rebuildBrands() {
  let lastError;
  for (let attempt = 0; attempt <= BRAND_REBUILD_MAX_RETRIES; attempt++) {
    try {
      return await rebuildBrandsOnce();
    } catch (e) {
      lastError = e;
      if (attempt === BRAND_REBUILD_MAX_RETRIES) break;
      const delay = BRAND_REBUILD_BACKOFF_MS[attempt] ?? 15000;
      console.log(`[scraper] Brand rebuild retry ${attempt + 1}/${BRAND_REBUILD_MAX_RETRIES} after ${delay}ms (${e?.message?.slice(0, 100)})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Read job for cooperative cancellation + checkpoint inspection ───
async function readJob(jobId) {
  try {
    const rows = await supaFetch(
      `/sync_runs?id=eq.${jobId}&select=id,status,started_at,creatives_synced,new_creatives,updated_creatives,total_api,progress&limit=1`
    );
    return rows?.[0] || null;
  } catch (e) {
    console.error('[scraper] readJob failed:', e.message);
    return null;
  }
}

// ─── Update job progress (always stamps heartbeat + next_skip) ───
async function updateProgress(jobId, progress, extraColumns = {}) {
  const stamped = {
    ...progress,
    last_heartbeat: nowIso(),
  };
  try {
    await supaFetch(`/sync_runs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...extraColumns, progress: stamped }),
    });
  } catch (e) {
    console.error('[scraper] progress update failed:', e.message);
  }
}

// ─── Update job counters + progress in a single DB call ───
async function updateJobState(jobId, counters, progress) {
  const stamped = progress
    ? { ...progress, last_heartbeat: nowIso() }
    : undefined;
  try {
    await supaFetch(`/sync_runs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(stamped ? { ...counters, progress: stamped } : counters),
    });
  } catch (e) {
    console.error('[scraper] job state update failed:', e.message);
  }
}

// ─── Create a new scrape job ───
// Optionally seed it with a `start_skip` (used when resuming a prior failed
// job). The progress payload always carries `last_heartbeat` and `next_skip`
// so cleanupStaleJobs and runScrapeLoop can rely on those fields.
async function createJob(triggerType, geoFilter = null, startSkip = 0, source = null) {
  const now = nowIso();
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
    ...(source ? { source } : {}),
    progress: {
      phase: 'initializing',
      percent: 5,
      message: startSkip > 0
        ? `Resuming from ${startSkip.toLocaleString()} creatives...`
        : 'Creating scrape job...',
      next_skip: startSkip,
      last_heartbeat: now,
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
      finished_at: nowIso(),
      error_message: message,
      progress: {
        phase: 'failed',
        percent: 100,
        message,
        last_heartbeat: nowIso(),
        steps: [
          ...steps,
          { id: 'fail', label: message, status: 'failed', ts: nowIso() },
        ],
      },
    }),
  }).catch(e => console.error('[scraper] failJob update failed:', e.message));
}

// ─── Check for existing running job ───
async function getActiveJob() {
  const pending = await supaFetch(
    '/sync_runs?status=in.("pending","running")&select=id,status,started_at,progress&order=started_at.desc&limit=1'
  );
  return pending?.[0] || null;
}

// ─── Find a recent failed job that can be resumed ───
// Resumable = failed within the last 24h, has progress.next_skip > 0, and was
// not manually cancelled by the admin (we don't auto-resume those — if the
// admin cancelled, they had a reason).
async function getResumableJob() {
  const cutoff = new Date(Date.now() - RESUMABLE_WINDOW_MS).toISOString();
  try {
    const rows = await supaFetch(
      `/sync_runs?status=eq.failed` +
      `&started_at=gt.${cutoff}` +
      `&progress->>next_skip=neq.0` +
      `&progress->>next_skip=not.is.null` +
      `&error_message=not.ilike.*Manually*` +
      `&error_message=not.ilike.*Cancelled*` +
      `&select=id,started_at,progress,creatives_synced,total_api` +
      `&order=started_at.desc&limit=1`
    );
    const row = rows?.[0];
    if (!row) return null;
    const nextSkip = parseInt(row.progress?.next_skip || '0', 10);
    if (!Number.isFinite(nextSkip) || nextSkip <= 0) return null;
    return { ...row, next_skip: nextSkip };
  } catch (e) {
    console.error('[scraper] getResumableJob failed:', e.message);
    return null;
  }
}

// ─── Trigger the next chunk via internal HTTP ───
// Fire-and-forget POST to /api/admin/scraper/continue. We await the request
// long enough for it to be SENT (so the chain is initiated) but don't wait
// for the response. The continuation lambda returns immediately and runs the
// next chunk in its own waitUntil window.
//
// The previous self-chain attempt died against Vercel's deployment-protection
// edge layer. Two defenses against that here:
//   1. Always send `Authorization: Bearer $CRON_SECRET` so the receiver auth
//      passes the moment the route handler runs.
//   2. If `VERCEL_AUTOMATION_BYPASS_SECRET` is set (Project Settings →
//      Deployment Protection → Protection Bypass for Automation), pass it as
//      `x-vercel-protection-bypass` so the request bypasses the edge SSO/
//      password layer before reaching our handler. No-op when not set.
async function triggerContinuation(jobId, startSkip) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[scraper] CRON_SECRET not configured — cannot chain continuation');
    return false;
  }

  const url = `${selfBaseUrl()}/api/admin/scraper/continue`;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cronSecret}`,
  };
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;

  try {
    // 5s timeout: the receiver returns ~50ms after starting its waitUntil.
    // If we don't get a response in 5s, something is wrong — but the request
    // is already in-flight, so the chain may still proceed. Heartbeat-based
    // staleness recovery is the backstop either way.
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ job_id: jobId, start_skip: startSkip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[scraper] continuation chain HTTP ${res.status}: ${text.slice(0, 200)}`);
      return false;
    }
    console.log(`[scraper] Chained continuation for job ${jobId} at skip=${startSkip}`);
    return true;
  } catch (e) {
    console.error(`[scraper] continuation chain fetch failed:`, e.message);
    return false;
  }
}

/**
 * Run the scrape loop with pipelined fetch + upsert.
 *
 * Pipeline pattern: while upserting batch N, prefetch batch N+1.
 * This overlaps network I/O and cuts total time by ~40-50%.
 *
 * Cooperative cancellation: every PROGRESS_UPDATE_INTERVAL batches we re-read
 * the job's status. If it's been flipped to 'failed' (admin clicked Cancel),
 * we exit cleanly without further DB writes.
 *
 * @param {Object} options
 * @param {string}  options.jobId
 * @param {string}  options.cookie
 * @param {number} [options.startSkip=0]        - Skip offset to resume from
 * @param {number} [options.maxBatches=Infinity]- Cap batches per invocation
 * @param {boolean}[options.skipBrandRebuild=false]
 * @returns {Object}
 */
async function runScrapeLoop({
  jobId,
  cookie,
  startSkip = 0,
  maxBatches = Infinity,
  skipBrandRebuild = false,
}) {
  const loopStartTime = nowIso();
  // Load brand-prefix dictionary once per chunk. Used by extractCelebrity
  // in upsertCreatives to recover celebrity_name from offerName when
  // SpyOwl's celebrityName field is empty.
  const brandPrefixes = await loadBrandPrefixes();
  let skip = startSkip;
  let totalFetched = 0;
  let totalSynced = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let hasMore = true;
  let spyowlTotal = 0;
  let consecutiveErrors = 0;
  let batchCount = 0;
  let cancelled = false;
  let authExpired = false;
  // Reset on every successful page; used by the abort-only-after-stagnation
  // rule so a flurry of transient errors that resolves quickly no longer
  // kills the job.
  let lastSuccessAt = Date.now();
  const errors = [];

  console.log(`[scraper] Loop start job=${jobId} skip=${startSkip} maxBatches=${maxBatches}`);

  // Mark running + heartbeat
  await supaFetch(`/sync_runs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'running',
      progress: {
        phase: 'scanning',
        percent: 12,
        message: startSkip > 0
          ? `Resuming scrape from ${startSkip.toLocaleString()}...`
          : 'Scraping creatives...',
        next_skip: startSkip,
        last_heartbeat: loopStartTime,
        steps: [
          { id: 'init', label: 'Job created',     status: 'done',   ts: loopStartTime },
          { id: 'auth', label: 'Authenticated',   status: 'done',   ts: loopStartTime },
          { id: 'scan', label: 'Scraping...',     status: 'active', ts: loopStartTime },
        ],
      },
    }),
  }).catch(() => {});

  // ─── PIPELINED SCRAPE LOOP ───
  let nextFetchPromise = null;

  while (hasMore && batchCount < maxBatches && !cancelled && !authExpired) {
    let page;

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

      // Auth failure short-circuit: the cookie is dead. Stop the loop and
      // let the caller mark the job "cookie expired" with a clear message
      // — there's no point in burning the abort budget on more 401s.
      if (isAuthFailureMessage(e?.message)) {
        authExpired = true;
        errors.push(`auth_expired at skip=${skip}: ${e.message}`);
        console.error(`[scraper] Auth failure at skip=${skip} — exiting loop:`, e.message);
        break;
      }

      consecutiveErrors++;
      errors.push(`skip=${skip}: ${e.message}`);
      console.error(`[scraper] Batch error at skip=${skip} (consecutive=${consecutiveErrors}):`, e.message);

      // Abort only when we're both at the error threshold AND haven't made
      // progress for a meaningful window. A storm of errors that resolves
      // quickly stops being a job-killer.
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const stagnantMs = Date.now() - lastSuccessAt;
        if (stagnantMs >= ABORT_AFTER_NO_PROGRESS_MS) {
          console.error(`[scraper] Abort: ${consecutiveErrors} consecutive errors AND ${Math.round(stagnantMs / 1000)}s without progress`);
          break;
        }
      }
      skip += BATCH_SIZE;
      batchCount++;
      continue;
    }

    if (!page) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const stagnantMs = Date.now() - lastSuccessAt;
        if (stagnantMs >= ABORT_AFTER_NO_PROGRESS_MS) break;
      }
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

    // ── Pipeline next batch ──
    const nextSkip = skip + BATCH_SIZE;
    const shouldPrefetch = hasMore && (batchCount + 1) < maxBatches;
    if (shouldPrefetch) {
      nextFetchPromise = fetchWithRetry(cookie, nextSkip, BATCH_SIZE).catch(() => null);
    }

    // ── Upsert current ──
    try {
      const upsertResult = await upsertCreatives(creatives, brandPrefixes);
      totalInserted += upsertResult.inserted || 0;
      totalUpdated  += upsertResult.updated  || 0;
    } catch (e) {
      errors.push(`upsert at skip=${skip}: ${e.message}`);
      console.error(`[scraper] Upsert error at skip=${skip}:`, e.message);
    }

    totalFetched += creatives.length;
    totalSynced  += creatives.length;
    skip += BATCH_SIZE;
    batchCount++;
    consecutiveErrors = 0;
    lastSuccessAt = Date.now();

    // ── Periodic progress + heartbeat + cooperative cancel check ──
    if (batchCount % PROGRESS_UPDATE_INTERVAL === 0 || !hasMore || batchCount >= maxBatches) {
      const globalFetched = startSkip + totalFetched;
      const displayTotal = spyowlTotal || globalFetched;
      const pct = Math.min(10 + Math.round((globalFetched / Math.max(displayTotal, 1)) * 70), 80);

      // Cooperative cancellation: did the admin click Cancel?
      const live = await readJob(jobId);
      if (live && live.status === 'failed') {
        console.log(`[scraper] Job ${jobId} was cancelled externally — exiting loop`);
        cancelled = true;
        break;
      }

      await updateJobState(jobId, {
        creatives_synced:  globalFetched,
        new_creatives:     totalInserted,
        updated_creatives: totalUpdated,
        total_api:         spyowlTotal,
      }, {
        phase: 'scanning',
        percent: pct,
        message: `Fetched ${globalFetched.toLocaleString()} of ${displayTotal.toLocaleString()} creatives...`,
        next_skip: skip,
        steps: [
          { id: 'init', label: 'Job created',     status: 'done',   ts: loopStartTime },
          { id: 'auth', label: 'Authenticated',   status: 'done',   ts: loopStartTime },
          { id: 'scan', label: `${globalFetched.toLocaleString()} creatives fetched`, status: 'active', ts: nowIso() },
        ],
      });

      console.log(`[scraper] Progress: ${globalFetched}/${displayTotal} (${pct}%) — batch ${batchCount}`);
    }
  }

  // abortedEarly = error abort (consecutive errors AND no recent progress)
  // distinguished from authExpired which is its own signal
  const abortedEarly = consecutiveErrors >= MAX_CONSECUTIVE_ERRORS &&
    (Date.now() - lastSuccessAt) >= ABORT_AFTER_NO_PROGRESS_MS;
  const reachedChunkLimit = batchCount >= maxBatches && hasMore;
  const scrapeComplete = !hasMore && !cancelled && !authExpired;

  console.log(`[scraper] Chunk done: fetched=${totalFetched} (cum=${startSkip + totalFetched}), hasMore=${hasMore}, aborted=${abortedEarly}, chunkLimit=${reachedChunkLimit}, cancelled=${cancelled}`);

  // ─── BRAND REBUILD ───
  let brandsUpdated = 0;
  let brandError = null;

  if (!skipBrandRebuild && scrapeComplete) {
    const globalTotal = startSkip + totalFetched;
    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: 'Rebuilding brand aggregates...',
      next_skip: skip,
      steps: [
        { id: 'init',   label: 'Job created',     status: 'done',   ts: loopStartTime },
        { id: 'auth',   label: 'Authenticated',   status: 'done',   ts: loopStartTime },
        { id: 'scan',   label: `${globalTotal.toLocaleString()} creatives synced`, status: 'done', ts: nowIso() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: nowIso() },
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

  // ─── FINALIZE (only when scrape is fully complete AND not skipping brands) ───
  // NOTE: production trigger/continue/cron always pass skipBrandRebuild: true, so this
  // block is currently unreachable. Kept correct for local/dev single-shot runs.
  if (scrapeComplete && !skipBrandRebuild) {
    const globalTotal = startSkip + totalFetched;
    const finishedAt = nowIso();

    let finalStatus = 'completed';
    let errorMessage = null;

    if (globalTotal === 0) {
      finalStatus = 'failed';
      errorMessage = 'No creatives fetched';
    } else if (abortedEarly || brandError) {
      finalStatus = 'completed_with_errors';
      const parts = [];
      if (abortedEarly) {
        parts.push(
          `Aborted after ${MAX_CONSECUTIVE_ERRORS} consecutive batch failures at offset ${skip}`,
        );
      }
      if (brandError)   parts.push(`Brand rebuild failed: ${brandError}`);
      if (errors.length > 0) parts.push(`${errors.length} batch error(s)`);
      errorMessage = parts.join('. ');
    }

    await updateJobState(
      jobId,
      {
        status: finalStatus,
        finished_at: finishedAt,
        creatives_synced:  globalTotal,
        brands_updated:    brandsUpdated,
        new_creatives:     totalInserted,
        updated_creatives: totalUpdated,
        total_api:         spyowlTotal,
        error_message:     errorMessage,
      },
      {
        phase: 'done',
        percent: 100,
        next_skip: skip,
        message: errorMessage
          ? `Done with warnings: ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`
          : `Done! ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`,
        steps: [
          { id: 'init',   label: 'Job created',                                            status: 'done',                              ts: loopStartTime },
          { id: 'auth',   label: 'Authenticated',                                          status: 'done',                              ts: loopStartTime },
          { id: 'scan',   label: `${globalTotal.toLocaleString()} creatives synced`,      status: abortedEarly ? 'warning' : 'done',   ts: nowIso() },
          { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands updated`, status: brandError ? 'warning' : 'done', ts: nowIso() },
          { id: 'done',   label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
        ],
      },
    );
  }

  return {
    totalFetched,
    totalSynced,
    totalInserted,
    totalUpdated,
    hasMore: hasMore && !abortedEarly && !cancelled && !authExpired,
    nextSkip: skip,
    spyowlTotal,
    brandsUpdated,
    abortedEarly,
    reachedChunkLimit,
    cancelled,
    authExpired,
    brandError,
    errors,
  };
}

export {
  SPYOWL_API,
  BATCH_SIZE,
  MAX_BATCHES_PER_CHUNK,
  MAX_CREATIVES,
  MAX_CONSECUTIVE_ERRORS,
  ABORT_AFTER_NO_PROGRESS_MS,
  HEARTBEAT_STALE_MS,
  STARTED_STALE_MS,
  RESUMABLE_WINDOW_MS,
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  fetchCreativePage,
  fetchWithRetry,
  isAuthFailureMessage,
  normalizeOffer,
  upsertCreatives,
  rebuildBrands,
  readJob,
  updateProgress,
  updateJobState,
  createJob,
  failJob,
  getActiveJob,
  getResumableJob,
  triggerContinuation,
  runScrapeLoop,
  selfBaseUrl,
};
