import { waitUntil } from '@vercel/functions';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import {
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  getActiveJob,
  getResumableJob,
  createJob,
  failJob,
  runScrapeLoop,
  rebuildBrands,
  updateProgress,
  updateJobState,
  triggerContinuation,
  MAX_BATCHES_PER_CHUNK,
} from '@/lib/scraper';

export const maxDuration = 300;

/**
 * POST /api/admin/scraper/trigger
 *
 * Manual scrape trigger from the admin dashboard.
 *
 * Architecture: chunked + resumable. This lambda runs the FIRST chunk
 * (~30k creatives, ~90s wallclock) inline via waitUntil, then chains to
 * /api/admin/scraper/continue for subsequent chunks. Total scrape spans
 * 3+ lambda invocations, none of which approach the 300s ceiling. See
 * /api/admin/scraper/continue for the chunk runner.
 *
 * Body (optional):
 *   { geo_filter?: string, resume?: boolean }
 *   - resume: when true, look for a recent failed job with progress.next_skip
 *     and start the new job from that skip. Manual default is false (fresh
 *     start) so the admin "Run Scrape Now" button matches user expectation.
 */
export async function POST(request) {
  try {
    verifyAdmin(request);
    await cleanupStaleJobs();

    const body = await request.json().catch(() => ({}));
    const geoFilter = body.geo_filter || null;
    const wantResume = !!body.resume;

    // Block if a healthy job is already in flight (cleanupStaleJobs above
    // means this only catches actually-running jobs).
    const active = await getActiveJob();
    if (active) {
      return Response.json(
        { error: 'A scrape is already in progress', existing_job: active },
        { status: 409 },
      );
    }

    // ─── Resume? ───
    let startSkip = 0;
    let resumedFrom = null;
    if (wantResume) {
      const resumable = await getResumableJob();
      if (resumable) {
        startSkip = resumable.next_skip;
        resumedFrom = resumable.id;
        console.log(`[trigger] Resuming from job ${resumedFrom} at skip=${startSkip}`);
      }
    }

    const job = await createJob('manual', geoFilter, startSkip);

    // ─── SpyOwl auth ───
    const cookie = await getSpyOwlCookie();
    const cookieOk = await validateSpyOwl(cookie);
    if (!cookieOk) {
      const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
      await failJob(job.id, msg, job.progress?.steps || []);
      return Response.json(
        { success: false, job_id: job.id, error: msg },
        { status: 503 },
      );
    }

    await updateProgress(job.id, {
      phase: 'scanning',
      percent: 12,
      message: startSkip > 0
        ? `Resuming from ${startSkip.toLocaleString()} creatives — starting first chunk...`
        : 'SpyOwl authenticated — starting first chunk...',
      next_skip: startSkip,
      steps: [
        { id: 'init', label: 'Job created',           status: 'done',   ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done',   ts: new Date().toISOString() },
        { id: 'scan', label: 'Scraping creatives...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    console.log(`[trigger] Job ${job.id} created (resume=${wantResume}, startSkip=${startSkip}) — running first chunk inline`);

    waitUntil(runFirstChunk(job.id, cookie, startSkip));

    return Response.json({
      success: true,
      job_id: job.id,
      resumed_from: resumedFrom,
      start_skip: startSkip,
      message: 'Scrape started — chunked execution in background',
    });
  } catch (error) {
    console.error('[trigger] Fatal error:', error.message);
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Run the first chunk and chain to continuation, OR finalize if the whole
 * scrape fits in one chunk (rare — only when starting from a near-end skip,
 * e.g. resuming from skip=78000 of 80000).
 *
 * This mirrors the logic in /api/admin/scraper/continue's runChunk; we
 * duplicate it here rather than abstracting because the trigger lambda has
 * already done extra setup (SpyOwl validation, job creation) that a pure
 * "runChunk" helper shouldn't re-do.
 */
async function runFirstChunk(jobId, cookie, startSkip) {
  try {
    const result = await runScrapeLoop({
      jobId,
      cookie,
      startSkip,
      maxBatches: MAX_BATCHES_PER_CHUNK,
      skipBrandRebuild: true,
    });

    if (result?.cancelled) {
      console.log(`[trigger] Job ${jobId} cancelled during first chunk`);
      return;
    }

    if (result?.authExpired) {
      const cum = startSkip + (result.totalFetched || 0);
      await failJob(
        jobId,
        `SpyOwl cookie expired or invalid (after ${cum.toLocaleString()} creatives) — refresh in Settings → SpyOwl Cookie and resume`,
      );
      return;
    }

    if (result?.abortedEarly) {
      const cum = startSkip + (result.totalFetched || 0);
      await failJob(
        jobId,
        `Aborted at skip=${result.nextSkip} after sustained errors (reached ${cum.toLocaleString()} creatives) — resume to continue from this point`,
      );
      return;
    }

    if (result?.hasMore) {
      const chained = await triggerContinuation(jobId, result.nextSkip);
      if (!chained) {
        console.error(`[trigger] Job ${jobId} first chunk done but chain to ${result.nextSkip} failed; awaiting stale-cleanup recovery`);
      }
      return;
    }

    // Single-chunk scrape — finalize here.
    const totalCreatives = result.nextSkip;
    const inserted = result.totalInserted || 0;
    const updated  = result.totalUpdated  || 0;

    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: `Rebuilding brand aggregates from ${totalCreatives.toLocaleString()} creatives...`,
      next_skip: result.nextSkip,
      steps: [
        { id: 'init',   label: 'Job created',                                            status: 'done',   ts: new Date().toISOString() },
        { id: 'auth',   label: 'Authenticated',                                          status: 'done',   ts: new Date().toISOString() },
        { id: 'scan',   label: `${totalCreatives.toLocaleString()} creatives synced (${inserted.toLocaleString()} new, ${updated.toLocaleString()} updated)`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...',                                   status: 'active', ts: new Date().toISOString() },
      ],
    });

    let brandsUpdated = 0;
    let brandsInserted = 0;
    let brandsOrphaned = 0;
    let brandError = null;
    try {
      const br = await rebuildBrands();
      brandsUpdated  = br?.brands_updated  || 0;
      brandsInserted = br?.brands_inserted || 0;
      brandsOrphaned = br?.brands_orphaned || 0;
    } catch (e) {
      brandError = e.message;
      console.error(`[trigger] Brand rebuild failed:`, e.message);
    }

    const finishedAt = new Date().toISOString();
    await updateJobState(
      jobId,
      {
        status: brandError ? 'completed_with_errors' : 'completed',
        finished_at: finishedAt,
        creatives_synced:  totalCreatives,
        new_creatives:     inserted,
        updated_creatives: updated,
        brands_updated:    brandsUpdated,
        new_brands:        brandsInserted,
        error_message:     brandError,
      },
      {
        phase: 'done',
        percent: 100,
        next_skip: result.nextSkip,
        message: brandError
          ? `Done with brand rebuild errors: ${brandError}`
          : `Done! ${totalCreatives.toLocaleString()} creatives (${inserted.toLocaleString()} new), ${brandsUpdated.toLocaleString()} brands (${brandsInserted.toLocaleString()} new, ${brandsOrphaned.toLocaleString()} orphaned)`,
        steps: [
          { id: 'init',   label: 'Job created',                                            status: 'done',                          ts: finishedAt },
          { id: 'auth',   label: 'Authenticated',                                          status: 'done',                          ts: finishedAt },
          { id: 'scan',   label: `${totalCreatives.toLocaleString()} creatives synced`,    status: 'done',                          ts: finishedAt },
          { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands rebuilt`, status: brandError ? 'error' : 'done', ts: finishedAt },
          { id: 'done',   label: brandError ? 'Completed with errors' : 'Scrape complete', status: brandError ? 'warning' : 'done', ts: finishedAt },
        ],
      },
    );
  } catch (err) {
    console.error(`[trigger] runFirstChunk fatal:`, err.message);
    try {
      await failJob(jobId, `First chunk crashed: ${err.message}`);
    } catch (e) {
      console.error(`[trigger] Could not persist failure:`, e.message);
    }
  }
}
