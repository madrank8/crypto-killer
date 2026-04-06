import { supaFetch } from '@/lib/supabase';
import {
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  getActiveJob,
  createJob,
  failJob,
  runScrapeLoop,
} from '@/lib/scraper';

const BATCHES_PER_CHUNK = 3; // Process 3 batches per invocation (~1500 creatives)
const MAX_CHAINS = 200; // Safety limit to prevent infinite loops

/**
 * GET /api/cron/scrape
 * Vercel Cron Job — runs every 24 hours at midnight UTC
 *
 * Self-chaining: processes BATCHES_PER_CHUNK batches, then calls itself
 * with ?resume=SKIP&job=JOB_ID&chain=N to continue in a new invocation.
 * This keeps each function call within Vercel's timeout limits.
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

    // ─── Parse continuation params ───
    const url = new URL(request.url);
    const resumeSkip = parseInt(url.searchParams.get('resume') || '0', 10);
    const existingJobId = url.searchParams.get('job') || null;
    const chainCount = parseInt(url.searchParams.get('chain') || '0', 10);
    const isResume = resumeSkip > 0 && existingJobId;

    // Safety: prevent infinite chain loops
    if (chainCount >= MAX_CHAINS) {
      console.error(`[cron] Max chain limit (${MAX_CHAINS}) reached, aborting`);
      if (existingJobId) {
        await supaFetch(`/sync_runs?id=eq.${existingJobId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_message: `Aborted: exceeded max chain limit of ${MAX_CHAINS} invocations`,
          }),
        }).catch(() => {});
      }
      return Response.json({ error: 'Max chain limit reached' }, { status: 500 });
    }

    // ─── SETUP (only on first invocation) ───
    let jobId = existingJobId;
    let cookie;

    if (!isResume) {
      await cleanupStaleJobs();

      // Check for existing running job
      const active = await getActiveJob();
      if (active) {
        return Response.json({
          skipped: true,
          reason: 'Scrape already in progress',
          existing_job: active,
        });
      }

      // Validate SpyOwl
      cookie = await getSpyOwlCookie();
      const spyowlOk = await validateSpyOwl(cookie);

      if (!spyowlOk) {
        // Log a failed job so it shows in history
        const failedJob = await createJob('scheduled');
        const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
        await failJob(failedJob.id, msg);
        return Response.json({ success: false, error: msg }, { status: 503 });
      }

      // Create the job
      const job = await createJob('scheduled');
      jobId = job.id;
    } else {
      // Resuming — get cookie for continued scraping
      cookie = await getSpyOwlCookie();
      if (!cookie) {
        await failJob(jobId, 'Cookie expired mid-scrape');
        return Response.json({ success: false, error: 'Cookie expired mid-scrape' }, { status: 503 });
      }
    }

    // ─── RUN SCRAPE CHUNK ───
    const result = await runScrapeLoop({
      jobId,
      cookie,
      startSkip: resumeSkip,
      maxBatches: BATCHES_PER_CHUNK,
      skipBrandRebuild: true, // We handle brand rebuild after all chunks
    });

    // ─── CONTINUE OR FINALIZE ───
    if (result.hasMore && !result.abortedEarly) {
      // More data to fetch — chain to next invocation
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      const nextUrl = `${siteUrl}/api/cron/scrape?resume=${result.nextSkip}&job=${jobId}&chain=${chainCount + 1}`;

      // Fire-and-forget: trigger next chunk
      fetch(nextUrl, {
        headers: { Authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(5000),
      }).catch(e => {
        console.error('[cron] Failed to chain next chunk:', e.message);
      });

      return Response.json({
        continuing: true,
        job_id: jobId,
        chain: chainCount + 1,
        skip: result.nextSkip,
        fetched_this_chunk: result.totalFetched,
      });
    }

    // All data fetched (or aborted) — rebuild brands and finalize
    // runScrapeLoop already finalized the job when hasMore=false and skipBrandRebuild=false
    // But we set skipBrandRebuild=true, so we need to rebuild + finalize here

    const { rebuildBrands } = await import('@/lib/scraper');
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

    // Finalize the job
    const globalTotal = result.nextSkip; // total creatives processed across all chunks
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
            { id: 'init', label: 'Cron triggered', status: 'done', ts: new Date().toISOString() },
            { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: result.abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands updated`, status: brandError ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'done', label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
          ],
        },
      }),
    }).catch(e => console.error('[cron] finalize failed:', e.message));

    return Response.json({
      success: true,
      job_id: jobId,
      trigger_type: 'scheduled',
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
