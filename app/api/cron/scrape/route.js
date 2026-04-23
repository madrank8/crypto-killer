import { waitUntil } from '@vercel/functions';
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
  updateJobState,
} from '@/lib/scraper';

// Match the manual trigger's budget — the full scrape runs inline inside
// this lambda's waitUntil window, no HTTP hop, no deployment-protected
// self-chain. A populated SpyOwl account (~80k creatives) completes in
// ~120s with pipelined prefetch; well inside the 300s maxDuration budget.
export const maxDuration = 300;

/**
 * GET /api/cron/scrape
 *
 * Vercel Cron daily midnight UTC. Creates a sync_runs job, validates SpyOwl,
 * then runs the full scrape inline via waitUntil() so the HTTP response
 * returns immediately while the worker executes in the background.
 *
 * Previously self-chained across invocations via fetch(nextUrl) — that path
 * died silently against Vercel's deployment protection SSO layer, which
 * intercepted the outbound chain request before our Authorization header
 * check could run. Result: chunk 0 completed, chunk 1 never started,
 * sync_runs stuck at ~20,000/~28% until the 1-hour stale-job cleanup
 * auto-failed it. Every scheduled run had the same symptom while manual
 * triggers (which already used inline waitUntil) worked in ~2 minutes.
 *
 * This route now mirrors /api/admin/scraper/trigger exactly — single lambda,
 * single waitUntil, no chaining.
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

    // ─── SETUP ───
    await cleanupStaleJobs();

    const active = await getActiveJob();
    if (active) {
      return Response.json({
        skipped: true,
        reason: 'Scrape already in progress',
        existing_job: active,
      });
    }

    // Create the job first so we can record failure state if auth fails
    const job = await createJob('scheduled');

    // Validate SpyOwl cookie
    const cookie = await getSpyOwlCookie();
    const spyowlOk = await validateSpyOwl(cookie);

    if (!spyowlOk) {
      const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
      await failJob(job.id, msg, job.progress?.steps || []);
      return Response.json({ success: false, job_id: job.id, error: msg }, { status: 503 });
    }

    // Update progress to show auth passed
    await updateProgress(job.id, {
      phase: 'scanning',
      percent: 12,
      message: 'SpyOwl authenticated — starting scheduled scrape...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: 'Scraping creatives...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    console.log(`[cron] Job ${job.id} created — running full scrape inline via waitUntil`);

    // Run the full scrape in the background. waitUntil keeps the lambda
    // alive up to maxDuration after the response is sent.
    waitUntil(runFullScrape(job.id, cookie));

    return Response.json({
      success: true,
      job_id: job.id,
      message: 'Scheduled scrape started — processing in background',
    });
  } catch (error) {
    console.error('[cron] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Run the whole scrape end-to-end: fetch all creatives, then rebuild brands.
 * Mirrors runFullScrape in /api/admin/scraper/trigger — errors are caught
 * and recorded on the job row so the admin UI can render a failure state;
 * this function never rethrows.
 */
async function runFullScrape(jobId, cookie) {
  try {
    console.log(`[cron] Scrape start for job ${jobId}`);

    // maxBatches: Infinity — runScrapeLoop pipelines API pages and keeps
    // pulling until SpyOwl says hasMore=false. Skip the brand rebuild here;
    // we do it explicitly below after all creatives are ingested.
    const result = await runScrapeLoop({
      jobId,
      cookie,
      startSkip: 0,
      skipBrandRebuild: true,
    });

    const total = result?.nextSkip || result?.totalFetched || 0;
    const inserted = result?.totalInserted || 0;
    const updated = result?.totalUpdated || 0;
    console.log(`[cron] Scrape loop done: fetched=${total} (inserted=${inserted}, updated=${updated}), hasMore=${result?.hasMore}, abortedEarly=${result?.abortedEarly}`);

    if (result?.hasMore && !result?.abortedEarly) {
      // Shouldn't happen with maxBatches=Infinity unless the loop hit a
      // soft abort condition. Mark as failed with diagnostic info.
      await failJob(jobId, `Loop exited with hasMore=true at skip=${result.nextSkip} (maxBatches reached?)`);
      return;
    }

    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: `Rebuilding brand aggregates from ${total.toLocaleString()} creatives...`,
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'Authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: `${total.toLocaleString()} creatives synced (${inserted.toLocaleString()} new, ${updated.toLocaleString()} updated)`, status: result?.abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    let brandsUpdated = 0;
    let brandsInserted = 0;
    let brandsOrphaned = 0;
    let brandError = null;
    try {
      const brandResult = await rebuildBrands();
      brandsUpdated = brandResult?.brands_updated || 0;
      brandsInserted = brandResult?.brands_inserted || 0;
      brandsOrphaned = brandResult?.brands_orphaned || 0;
      console.log(`[cron] Brands rebuilt: ${brandsInserted} new, ${brandsUpdated} updated, ${brandsOrphaned} orphaned-zeroed`);
    } catch (e) {
      brandError = e.message;
      console.error(`[cron] Brand rebuild failed:`, e.message);
    }

    // ─── FINALIZE ───
    const finishedAt = new Date().toISOString();
    let finalStatus = 'completed';
    let errorMessage = null;

    if (total === 0) {
      finalStatus = 'failed';
      errorMessage = 'No creatives fetched';
    } else if (result?.abortedEarly || brandError) {
      finalStatus = brandError ? 'completed_with_errors' : 'completed';
      const parts = [];
      if (result?.abortedEarly) parts.push('Aborted after consecutive batch failures');
      if (brandError) parts.push(`Brand rebuild failed: ${brandError}`);
      errorMessage = parts.join('. ');
    }

    await updateJobState(
      jobId,
      {
        status: finalStatus,
        finished_at: finishedAt,
        creatives_synced: total,
        new_creatives: inserted,
        updated_creatives: updated,
        brands_updated: brandsUpdated,
        new_brands: brandsInserted,
        total_api: result?.spyowlTotal || 0,
        error_message: errorMessage,
      },
      {
        phase: 'done',
        percent: 100,
        message: errorMessage
          ? `Done with warnings: ${total.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`
          : `Done! ${total.toLocaleString()} creatives (${inserted.toLocaleString()} new), ${brandsUpdated.toLocaleString()} brands (${brandsInserted.toLocaleString()} new, ${brandsOrphaned.toLocaleString()} orphaned)`,
        steps: [
          { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
          { id: 'auth', label: 'Authenticated', status: 'done', ts: new Date().toISOString() },
          { id: 'scan', label: `${total.toLocaleString()} creatives synced (${inserted.toLocaleString()} new)`, status: result?.abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
          { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands rebuilt (${brandsInserted.toLocaleString()} new, ${brandsOrphaned.toLocaleString()} orphans zeroed)`, status: brandError ? 'error' : 'done', ts: new Date().toISOString() },
          { id: 'done', label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
        ],
      },
    );

    console.log(`[cron] Job ${jobId} finalized: ${finalStatus}, ${total} creatives, ${brandsUpdated} brands`);
  } catch (err) {
    console.error(`[cron] Scrape aborted:`, err.message);
    try {
      await failJob(jobId, `Scheduled scrape aborted: ${err.message}`);
    } catch (e) {
      console.error(`[cron] Could not persist failure state:`, e.message);
    }
  }
}
