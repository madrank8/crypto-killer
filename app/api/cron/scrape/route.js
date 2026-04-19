import { waitUntil } from '@vercel/functions';
import { supaFetch } from '@/lib/supabase';
import {
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  getActiveJob,
  createJob,
  failJob,
  runScrapeLoop,
  rebuildBrands,
  updateProgress,
} from '@/lib/scraper';

/**
 * Batches per chunk — how many 500-item API pages per invocation.
 * At ~2s per batch (pipelined), 40 batches ≈ 80s, well within 300s timeout.
 * 80k creatives / 500 / 40 = only 4 chained invocations.
 */
const BATCHES_PER_CHUNK = 40;
const MAX_CHAINS = 50; // Safety limit (40 batches × 50 chains = 1M creatives max)

/**
 * GET /api/cron/scrape
 *
 * Handles both:
 *  - Vercel Cron (daily midnight UTC) — creates its own job
 *  - Manual trigger delegation — picks up a pre-created job via ?job=ID
 *
 * Self-chaining: processes BATCHES_PER_CHUNK batches, then calls itself
 * with ?resume=SKIP&job=JOB_ID&chain=N to continue in a new invocation.
 */
export async function GET(request) {
  try {
    // ─── AUTH (required, never optional) ───
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('[cron] CRON_SECRET not configured');
      return Response.json({ error: 'Server misconfigured: CRON_SECRET not set' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== cronSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Parse params ───
    const url = new URL(request.url);
    const resumeSkip = parseInt(url.searchParams.get('resume') || '0', 10);
    const preCreatedJobId = url.searchParams.get('job') || null;
    const chainCount = parseInt(url.searchParams.get('chain') || '0', 10);
    const isResume = resumeSkip > 0;

    // Safety: prevent infinite chain loops
    if (chainCount >= MAX_CHAINS) {
      console.error(`[cron] Max chain limit (${MAX_CHAINS}) reached, aborting`);
      if (preCreatedJobId) {
        await failJob(preCreatedJobId, `Aborted: exceeded max chain limit of ${MAX_CHAINS} invocations`);
      }
      return Response.json({ error: 'Max chain limit reached' }, { status: 500 });
    }

    // ─── SETUP ───
    let jobId = preCreatedJobId;
    let cookie;

    if (!isResume && !preCreatedJobId) {
      // ── Normal cron: create everything from scratch ──
      await cleanupStaleJobs();

      const active = await getActiveJob();
      if (active) {
        return Response.json({
          skipped: true,
          reason: 'Scrape already in progress',
          existing_job: active,
        });
      }

      cookie = await getSpyOwlCookie();
      const spyowlOk = await validateSpyOwl(cookie);

      if (!spyowlOk) {
        const failedJob = await createJob('scheduled');
        const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
        await failJob(failedJob.id, msg);
        return Response.json({ success: false, error: msg }, { status: 503 });
      }

      const job = await createJob('scheduled');
      jobId = job.id;
    } else if (!isResume && preCreatedJobId) {
      // ── Pre-created job from trigger endpoint (first chunk) ──
      cookie = await getSpyOwlCookie();
      if (!cookie) {
        await failJob(jobId, 'SpyOwl cookie not available');
        return Response.json({ success: false, error: 'Cookie not available' }, { status: 503 });
      }
    } else {
      // ── Resuming a chain ──
      cookie = await getSpyOwlCookie();
      if (!cookie) {
        await failJob(jobId, 'Cookie expired mid-scrape');
        return Response.json({ success: false, error: 'Cookie expired mid-scrape' }, { status: 503 });
      }
    }

    console.log(`[cron] Starting chunk: job=${jobId}, skip=${resumeSkip}, chain=${chainCount}`);

    // ─── RUN SCRAPE CHUNK ───
    const result = await runScrapeLoop({
      jobId,
      cookie,
      startSkip: resumeSkip,
      maxBatches: BATCHES_PER_CHUNK,
      skipBrandRebuild: true, // Always skip — we rebuild after all chunks
    });

    // ─── CONTINUE OR FINALIZE ───
    if (result.hasMore && !result.abortedEarly) {
      // More data to fetch — chain to next invocation.
      // Prefer VERCEL_PROJECT_PRODUCTION_URL: with Vercel Authentication on,
      // VERCEL_URL points to a deployment-specific hostname that is 401'd
      // by the edge SSO before our route handler even runs.
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
        || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
        || (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : null)
        || 'http://localhost:3000';

      const nextUrl = `${siteUrl}/api/cron/scrape?resume=${result.nextSkip}&job=${jobId}&chain=${chainCount + 1}`;

      // Fire-and-forget chain to the next chunk. Wrapped in waitUntil()
      // so the outbound fetch survives this lambda's teardown — without
      // it Vercel kills the outbound TCP handshake the moment we send our
      // Response.json below. Also no AbortSignal (would tear down the
      // downstream lambda mid-work).
      waitUntil(
        fetch(nextUrl, {
          headers: { Authorization: `Bearer ${cronSecret}` },
        }).catch((e) => {
          console.error('[cron] Failed to chain next chunk:', e.message);
        }),
      );

      return Response.json({
        continuing: true,
        job_id: jobId,
        chain: chainCount + 1,
        skip: result.nextSkip,
        fetched_this_chunk: result.totalFetched,
      });
    }

    // ─── ALL DATA FETCHED — REBUILD BRANDS + FINALIZE ───
    const globalTotal = result.nextSkip;

    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: `Rebuilding brand aggregates from ${globalTotal.toLocaleString()} creatives...`,
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'Authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    let brandsUpdated = 0;
    let brandError = null;

    try {
      const brandResult = await rebuildBrands();
      brandsUpdated = brandResult?.brands_updated || 0;
      console.log(`[cron] Brands rebuilt: ${brandsUpdated}`);
    } catch (e) {
      brandError = e.message;
      console.error('[cron] Brand rebuild failed:', e.message);
    }

    // ─── FINALIZE ───
    const finishedAt = new Date().toISOString();
    let finalStatus = 'completed';
    let errorMessage = null;

    if (globalTotal === 0) {
      finalStatus = 'failed';
      errorMessage = 'No creatives fetched';
    } else if (result.abortedEarly || brandError) {
      const parts = [];
      if (result.abortedEarly) parts.push('Aborted after consecutive batch failures');
      if (brandError) parts.push(`Brand rebuild failed: ${brandError}`);
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
        new_creatives: globalTotal,
        total_api: result.spyowlTotal,
        error_message: errorMessage,
        progress: {
          phase: 'done',
          percent: 100,
          message: errorMessage
            ? `Done with warnings: ${globalTotal.toLocaleString()} creatives`
            : `Done! ${globalTotal.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`,
          steps: [
            { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
            { id: 'auth', label: 'Authenticated', status: 'done', ts: new Date().toISOString() },
            { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: result.abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands updated`, status: brandError ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'done', label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
          ],
        },
      }),
    }).catch(e => console.error('[cron] finalize failed:', e.message));

    console.log(`[cron] Job ${jobId} done: ${finalStatus}, ${globalTotal} creatives, ${brandsUpdated} brands, ${chainCount + 1} chains`);

    return Response.json({
      success: true,
      job_id: jobId,
      creatives_fetched: globalTotal,
      brands_updated: brandsUpdated,
      chains_used: chainCount + 1,
      error_message: errorMessage,
    });
  } catch (error) {
    console.error('[cron] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
