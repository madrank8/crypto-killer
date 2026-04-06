import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import {
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  getActiveJob,
  createJob,
  failJob,
  runScrapeLoop,
} from '@/lib/scraper';

/**
 * POST /api/admin/scraper/trigger
 * Inline scraper: fetches creatives from SpyOwl, upserts to Supabase, rebuilds brands via SQL
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
        { status: 409 }
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
        { status: 503 }
      );
    }

    // Run the full scrape
    const result = await runScrapeLoop({
      jobId: job.id,
      cookie,
      startSkip: 0,
    });

    return Response.json({
      success: true,
      job_id: job.id,
      status: result.abortedEarly || result.brandError ? 'completed_with_warnings' : 'completed',
      creatives_fetched: result.totalFetched,
      creatives_synced: result.totalSynced,
      brands_updated: result.brandsUpdated,
      spyowl_total: result.spyowlTotal,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error('[scraper] Fatal error:', error.message);
    if (error.message.includes('Unauthorized')) return unauthorizedResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}
