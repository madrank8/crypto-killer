import { waitUntil } from '@vercel/functions';
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
 * GET /api/cron/scrape
 *
 * Vercel Cron daily midnight UTC. Auto-resumes from the most recent failed
 * job's progress.next_skip (within 24h). This means a chain that broke
 * mid-flight yesterday will pick up where it left off today instead of
 * restarting from skip=0 — fixing the "scheduled cron makes zero forward
 * progress for days" pattern in the historical sync_runs data.
 *
 * Architecture: same as /api/admin/scraper/trigger — runs the first chunk
 * inline via waitUntil, chains to /api/admin/scraper/continue for the rest.
 */
export async function GET(request) {
  try {
    // ─── AUTH ───
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

    // ─── Auto-resume from prior failed job? ───
    let startSkip = 0;
    let resumedFrom = null;
    const resumable = await getResumableJob();
    if (resumable) {
      startSkip = resumable.next_skip;
      resumedFrom = resumable.id;
      console.log(`[cron] Resuming from job ${resumedFrom} at skip=${startSkip}`);
    }

    const job = await createJob('scheduled', null, startSkip);

    // ─── SpyOwl auth ───
    const cookie = await getSpyOwlCookie();
    const cookieOk = await validateSpyOwl(cookie);
    if (!cookieOk) {
      const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
      await failJob(job.id, msg, job.progress?.steps || []);
      return Response.json({ success: false, job_id: job.id, error: msg }, { status: 503 });
    }

    await updateProgress(job.id, {
      phase: 'scanning',
      percent: 12,
      message: startSkip > 0
        ? `Resuming scheduled scrape from ${startSkip.toLocaleString()} creatives...`
        : 'SpyOwl authenticated — starting scheduled scrape...',
      next_skip: startSkip,
      steps: [
        { id: 'init', label: 'Job created',           status: 'done',   ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done',   ts: new Date().toISOString() },
        { id: 'scan', label: 'Scraping creatives...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    console.log(`[cron] Job ${job.id} created (resume_from=${resumedFrom}, startSkip=${startSkip}) — running first chunk inline`);

    waitUntil(runFirstChunk(job.id, cookie, startSkip));

    return Response.json({
      success: true,
      job_id: job.id,
      resumed_from: resumedFrom,
      start_skip: startSkip,
      message: 'Scheduled scrape started — chunked execution in background',
    });
  } catch (error) {
    console.error('[cron] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/** Mirrors the trigger route — first chunk + chain or finalize. */
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
      console.log(`[cron] Job ${jobId} cancelled during first chunk`);
      return;
    }

    if (result?.abortedEarly) {
      const cum = startSkip + (result.totalFetched || 0);
      await failJob(
        jobId,
        `Aborted after 3 consecutive batch failures at skip=${result.nextSkip} (reached ${cum.toLocaleString()} creatives)`,
      );
      return;
    }

    if (result?.hasMore) {
      const chained = await triggerContinuation(jobId, result.nextSkip);
      if (!chained) {
        console.error(`[cron] Job ${jobId} first chunk done but chain to ${result.nextSkip} failed; awaiting stale-cleanup recovery`);
      }
      return;
    }

    // Whole scrape fit in one chunk — finalize.
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
      console.error(`[cron] Brand rebuild failed:`, e.message);
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
    console.error(`[cron] runFirstChunk fatal:`, err.message);
    try {
      await failJob(jobId, `First chunk crashed: ${err.message}`);
    } catch (e) {
      console.error(`[cron] Could not persist failure:`, e.message);
    }
  }
}
