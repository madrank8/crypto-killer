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
} from '@/lib/scraper';

const BATCHES_PER_CHUNK = 80; // 80 × 500 = 40K creatives per invocation (~160s, well within 300s)
const MAX_CHAINS = 500; // Safety limit — 500 × 40K = 20M creatives max

/**
 * POST /api/admin/scraper/trigger
 * Self-chaining scraper: processes chunks of creatives, then fires the next
 * invocation with ?resume=SKIP&job=JOB_ID&chain=N to continue.
 * This keeps each function call within Vercel's 300s timeout.
 */
export async function POST(request) {
  try {
    verifyAdmin(request);

    const body = await request.json().catch(() => ({}));
    const geoFilter = body.geo_filter || null;

    // ─── Parse continuation params ───
    const resumeSkip = body._resume || 0;
    const existingJobId = body._job || null;
    const chainCount = body._chain || 0;
    const isResume = resumeSkip > 0 && existingJobId;

    // Safety: prevent infinite chain loops
    if (chainCount >= MAX_CHAINS) {
      console.error(`[scraper] Max chain limit (${MAX_CHAINS}) reached, aborting`);
      if (existingJobId) {
        await failJob(existingJobId, `Aborted: exceeded max chain limit of ${MAX_CHAINS} invocations`);
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
        return Response.json(
          { error: 'A scrape is already in progress', existing_job: active },
          { status: 409 }
        );
      }

      // Validate SpyOwl cookie
      cookie = await getSpyOwlCookie();
      const spyowlOk = await validateSpyOwl(cookie);

      if (!spyowlOk) {
        const job = await createJob('manual', geoFilter);
        const msg = cookie ? 'SpyOwl API unreachable or cookie expired' : 'No SpyOwl cookie configured';
        await failJob(job.id, msg, job.progress?.steps || []);
        return Response.json(
          { success: false, job_id: job.id, error: msg },
          { status: 503 }
        );
      }

      // Create the job
      const job = await createJob('manual', geoFilter);
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
      // More data to fetch — fire-and-forget next chunk
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

      const nextBody = {
        geo_filter: geoFilter,
        _resume: result.nextSkip,
        _job: jobId,
        _chain: chainCount + 1,
      };

      // Self-chain: call ourselves with continuation params
      fetch(`${siteUrl}/api/admin/scraper/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.ADMIN_SECRET || ''}`,
        },
        body: JSON.stringify(nextBody),
        signal: AbortSignal.timeout(10000),
      }).catch(e => {
        console.error('[scraper] Failed to chain next chunk:', e.message);
      });

      return Response.json({
        continuing: true,
        job_id: jobId,
        chain: chainCount + 1,
        skip: result.nextSkip,
        fetched_this_chunk: result.totalFetched,
        spyowl_total: result.spyowlTotal,
      });
    }

    // ─── ALL DATA FETCHED — REBUILD BRANDS ───
    let brandsUpdated = 0;
    let brandError = null;

    try {
      const brandResult = await rebuildBrands();
      brandsUpdated = brandResult?.brands_updated || 0;
      console.log(`[scraper] Brands rebuilt: ${brandsUpdated}`);
    } catch (e) {
      brandError = e.message;
      console.error('[scraper] Brand rebuild failed:', e.message);
    }

    // ─── FINALIZE ───
    const globalTotal = result.nextSkip; // total creatives processed across all chunks
    let finalStatus = 'completed';
    let errorMessage = null;

    if (globalTotal === 0) {
      finalStatus = 'failed';
      errorMessage = 'No creatives fetched';
    } else if (result.abortedEarly || brandError) {
      const parts = [];
      if (result.abortedEarly) parts.push('Aborted after consecutive batch failures');
      if (brandError) parts.push(`Brand rebuild failed: ${brandError}`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} batch error(s)`);
      errorMessage = parts.join('. ');
    }

    const { supaFetch } = await import('@/lib/supabase');
    const finishedAt = new Date().toISOString();

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
            { id: 'init', label: 'Manual scrape triggered', status: 'done', ts: new Date().toISOString() },
            { id: 'scan', label: `${globalTotal.toLocaleString()} creatives synced`, status: result.abortedEarly ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'brands', label: brandError ? 'Brand rebuild failed' : `${brandsUpdated.toLocaleString()} brands updated`, status: brandError ? 'warning' : 'done', ts: new Date().toISOString() },
            { id: 'done', label: errorMessage ? 'Completed with warnings' : 'Scrape complete', status: errorMessage ? 'warning' : 'done', ts: finishedAt },
          ],
        },
      }),
    }).catch(e => console.error('[scraper] finalize failed:', e.message));

    return Response.json({
      success: true,
      job_id: jobId,
      status: result.abortedEarly || brandError ? 'completed_with_warnings' : 'completed',
      creatives_fetched: globalTotal,
      creatives_synced: globalTotal,
      brands_updated: brandsUpdated,
      spyowl_total: result.spyowlTotal,
      chains_used: chainCount + 1,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error('[scraper] Fatal error:', error.message);
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
