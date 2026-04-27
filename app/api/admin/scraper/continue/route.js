import { waitUntil } from '@vercel/functions';
import {
  getSpyOwlCookie,
  validateSpyOwl,
  readJob,
  failJob,
  runScrapeLoop,
  rebuildBrands,
  updateProgress,
  updateJobState,
  triggerContinuation,
  MAX_BATCHES_PER_CHUNK,
} from '@/lib/scraper';

// Same 300s ceiling as trigger/cron — but we only use ~120s of it per chunk.
export const maxDuration = 300;

/**
 * POST /api/admin/scraper/continue
 *
 * Internal continuation endpoint. Called by the trigger / cron / previous
 * continuation lambda to run the NEXT chunk of an in-flight scrape job.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (NOT the admin token — this is
 * machine-to-machine).
 *
 * Body: { job_id: string, start_skip: number }
 *
 * Behavior:
 *   1. Validates auth + body
 *   2. Loads the job; bails if status != 'running' (admin cancelled, or it
 *      was already completed by a stray previous chain)
 *   3. Validates start_skip matches progress.next_skip (idempotency — if a
 *      duplicate continuation fires, the second one no-ops)
 *   4. Runs ONE chunk (MAX_BATCHES_PER_CHUNK batches, ~30k creatives, ~90s)
 *   5. If hasMore: chains to itself with the new start_skip
 *      If !hasMore: rebuilds brands and finalizes the job
 */
export async function POST(request) {
  // ─── AUTH ───
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[continue] CRON_SECRET not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ─── BODY ───
  const body = await request.json().catch(() => ({}));
  const jobId = body.job_id;
  const startSkip = parseInt(body.start_skip ?? 0, 10);

  if (!jobId || !Number.isFinite(startSkip) || startSkip < 0) {
    return Response.json({ error: 'Invalid body: job_id and start_skip required' }, { status: 400 });
  }

  // ─── LOAD JOB + IDEMPOTENCY GUARD ───
  const job = await readJob(jobId);
  if (!job) {
    return Response.json({ error: `Job ${jobId} not found` }, { status: 404 });
  }
  if (job.status !== 'running' && job.status !== 'pending') {
    // Admin cancelled, or a prior chunk already finalized. No-op.
    console.log(`[continue] Job ${jobId} status=${job.status} — skipping continuation`);
    return Response.json({ skipped: true, reason: `status=${job.status}` });
  }
  const expectedSkip = parseInt(job.progress?.next_skip ?? 0, 10);
  if (Number.isFinite(expectedSkip) && expectedSkip > startSkip) {
    // Another continuation already advanced past our start_skip. Drop.
    console.log(`[continue] Job ${jobId} already at skip=${expectedSkip}, ignoring duplicate at ${startSkip}`);
    return Response.json({ skipped: true, reason: 'already advanced past start_skip' });
  }

  // ─── COOKIE ───
  // We re-validate cookie at every chunk so that if the cookie expires
  // mid-scrape, the job fails with a clear error instead of cascading 401s.
  const cookie = await getSpyOwlCookie();
  const cookieOk = await validateSpyOwl(cookie);
  if (!cookieOk) {
    const msg = cookie ? 'SpyOwl cookie expired mid-scrape' : 'SpyOwl cookie missing';
    await failJob(jobId, msg, job.progress?.steps || []);
    return Response.json({ success: false, job_id: jobId, error: msg }, { status: 503 });
  }

  // ─── KICK OFF CHUNK IN BACKGROUND ───
  console.log(`[continue] Job ${jobId} chunk start at skip=${startSkip}`);
  waitUntil(runChunk(jobId, cookie, startSkip));

  return Response.json({
    success: true,
    job_id: jobId,
    chunk_start_skip: startSkip,
    message: 'Continuation chunk started',
  });
}

/**
 * Run one chunk and decide what's next: another chunk, brand rebuild + finalize,
 * or fail. Errors are caught and persisted on the job row; this never rethrows.
 */
async function runChunk(jobId, cookie, startSkip) {
  try {
    const result = await runScrapeLoop({
      jobId,
      cookie,
      startSkip,
      maxBatches: MAX_BATCHES_PER_CHUNK,
      skipBrandRebuild: true, // brand rebuild only on the final chunk
    });

    if (result?.cancelled) {
      console.log(`[continue] Job ${jobId} cancelled by admin during chunk`);
      return;
    }

    if (result?.abortedEarly) {
      // Three consecutive batch failures — give up on this scrape, but keep
      // next_skip preserved so a future trigger can resume past the bad zone.
      const cum = startSkip + (result.totalFetched || 0);
      await failJob(
        jobId,
        `Aborted after 3 consecutive batch failures at skip=${result.nextSkip} (reached ${cum.toLocaleString()} creatives)`,
        [],
      );
      return;
    }

    if (result?.hasMore) {
      // More work to do — chain to next chunk.
      const nextStart = result.nextSkip;
      const chained = await triggerContinuation(jobId, nextStart);
      if (!chained) {
        // The chain failed. Don't fail the job — heartbeat-based stale
        // cleanup will reap it within ~3 min, and the daily cron (or a manual
        // retrigger) will resume from the preserved next_skip. Log loudly.
        console.error(`[continue] Job ${jobId} chunk done but chain to ${nextStart} failed; awaiting stale-cleanup recovery`);
      }
      return;
    }

    // ─── No more work — final chunk. Rebuild brands and finalize. ───
    const totalCreatives = result.nextSkip; // global cumulative
    const inserted = result.totalInserted || 0;
    const updated  = result.totalUpdated  || 0;

    await updateProgress(jobId, {
      phase: 'processing',
      percent: 85,
      message: `Rebuilding brand aggregates from ${totalCreatives.toLocaleString()} creatives...`,
      next_skip: result.nextSkip,
      steps: [
        { id: 'init',   label: 'Job created',                                              status: 'done',   ts: new Date().toISOString() },
        { id: 'auth',   label: 'Authenticated',                                            status: 'done',   ts: new Date().toISOString() },
        { id: 'scan',   label: `${totalCreatives.toLocaleString()} creatives synced (${inserted.toLocaleString()} new, ${updated.toLocaleString()} updated)`, status: 'done', ts: new Date().toISOString() },
        { id: 'brands', label: 'Rebuilding brands...',                                     status: 'active', ts: new Date().toISOString() },
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
      console.error(`[continue] Brand rebuild failed:`, e.message);
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
          { id: 'scan',   label: `${totalCreatives.toLocaleString()} creatives synced`,   status: 'done',                          ts: finishedAt },
          { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands rebuilt (${brandsInserted.toLocaleString()} new, ${brandsOrphaned.toLocaleString()} orphans zeroed)`, status: brandError ? 'error' : 'done', ts: finishedAt },
          { id: 'done',   label: brandError ? 'Completed with errors' : 'Scrape complete', status: brandError ? 'warning' : 'done', ts: finishedAt },
        ],
      },
    );

    console.log(`[continue] Job ${jobId} finalized: ${totalCreatives} creatives, ${brandsUpdated} brands`);
  } catch (err) {
    console.error(`[continue] runChunk fatal:`, err.message);
    try {
      await failJob(jobId, `Continuation chunk crashed: ${err.message}`);
    } catch (e) {
      console.error(`[continue] Could not persist failure:`, e.message);
    }
  }
}
