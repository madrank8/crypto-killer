import { waitUntil } from '@vercel/functions';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
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

// Same budget as the scheduled cron worker — the scrape runs entirely
// inside this lambda's waitUntil window, no HTTP hop.
export const maxDuration = 300;

/**
 * POST /api/admin/scraper/trigger
 * Creates a scrape job, validates SpyOwl, then runs the full scrape inline
 * via waitUntil() so the UI gets an immediate 200 while the worker executes
 * in the background. No inter-function fetch — that path kept dying against
 * Vercel's edge SSO layer (deployment protection blocks VERCEL_URL) no
 * matter how the outbound request was wrapped.
 */
export async function POST(request) {
  try {
    verifyAdmin(request);
    await cleanupStaleJobs();

    const body = await request.json().catch(() => ({}));
    const geoFilter = body.geo_filter || null;

    // Check for existing running job
    const active = await getActiveJob();
    if (active) {
      return Response.json(
        { error: 'A scrape is already in progress', existing_job: active },
        { status: 409 },
      );
    }

    // Create the job
    const job = await createJob('manual', geoFilter);

    // Validate SpyOwl cookie
    const cookie = await getSpyOwlCookie();
    const spyowlOk = await validateSpyOwl(cookie);

    if (!spyowlOk) {
      const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
      await failJob(job.id, msg, job.progress?.steps || []);
      return Response.json(
        { success: false, job_id: job.id, error: msg },
        { status: 503 },
      );
    }

    // Update progress to show auth passed
    await updateProgress(job.id, {
      phase: 'scanning',
      percent: 12,
      message: 'SpyOwl authenticated — starting scrape...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: 'Scraping creatives...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    console.log(`[trigger] Job ${job.id} created — running scrape inline via waitUntil`);

    // Run the full scrape in the background. waitUntil keeps the lambda
    // alive up to maxDuration after the response is sent.
    waitUntil(runFullScrape(job.id, cookie));

    return Response.json({
      success: true,
      job_id: job.id,
      message: 'Scrape job started — processing in background',
    });
  } catch (error) {
    console.error('[trigger] Fatal error:', error.message);
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Run the whole scrape end-to-end: fetch all creatives, then rebuild brands.
 * Errors are caught and recorded on the job row so the UI can render a
 * failure state; this function never rethrows.
 */
async function runFullScrape(jobId, cookie) {
  try {
    console.log(`[trigger] Scrape start for job ${jobId}`);

    // maxBatches: Infinity — runScrapeLoop pipelines API pages and will
    // keep pulling until SpyOwl says hasMore=false. On a populated account
    // (~80k creatives) this is ~60-150s with prefetch; well inside the
    // 300s maxDuration budget.
    const result = await runScrapeLoop({
      jobId,
      cookie,
      startSkip: 0,
      skipBrandRebuild: true, // We rebuild below after all creatives are in.
    });

    const total = result?.nextSkip || result?.totalFetched || 0;
    console.log(`[trigger] Scrape loop done: fetched=${total}, hasMore=${result?.hasMore}`);

    if (result?.hasMore) {
      // Shouldn't happen with maxBatches=Infinity unless the loop aborted
      // on repeated errors. Mark as failed with diagnostic info.
      await failJob(jobId, `Loop aborted before completion at skip=${result.nextSkip}`);
      return;
    }

    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: `Rebuilding brand aggregates from ${total.toLocaleString()} creatives...`,
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'Authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: `${total.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    let brandsUpdated = 0;
    let brandError = null;
    try {
      const brandResult = await rebuildBrands();
      brandsUpdated = brandResult?.brands_updated || 0;
      console.log(`[trigger] Brands rebuilt: ${brandsUpdated}`);
    } catch (e) {
      brandError = e.message;
      console.error(`[trigger] Brand rebuild failed:`, e.message);
    }

    // Finalize — updateJobState(jobId, counters, progress)
    await updateJobState(
      jobId,
      {
        status: brandError ? 'completed_with_errors' : 'completed',
        finished_at: new Date().toISOString(),
        creatives_synced: total,
        brands_updated: brandsUpdated,
        error_message: brandError,
      },
      {
        phase: 'done',
        percent: 100,
        message: brandError
          ? `Done with brand rebuild errors: ${brandError}`
          : `Done! ${total.toLocaleString()} creatives, ${brandsUpdated.toLocaleString()} brands`,
        steps: [
          { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
          { id: 'auth', label: 'Authenticated', status: 'done', ts: new Date().toISOString() },
          { id: 'scan', label: `${total.toLocaleString()} creatives synced`, status: 'done', ts: new Date().toISOString() },
          { id: 'brands', label: `${brandsUpdated.toLocaleString()} brands rebuilt`, status: brandError ? 'error' : 'done', ts: new Date().toISOString() },
        ],
      },
    );

    console.log(`[trigger] Scrape finalized for job ${jobId}`);
  } catch (err) {
    console.error(`[trigger] Scrape aborted:`, err.message);
    try {
      await failJob(jobId, `Scrape aborted: ${err.message}`);
    } catch (e) {
      console.error(`[trigger] Could not persist failure state:`, e.message);
    }
  }
}
