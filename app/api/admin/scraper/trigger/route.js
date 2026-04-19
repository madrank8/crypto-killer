import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import {
  cleanupStaleJobs,
  getSpyOwlCookie,
  validateSpyOwl,
  getActiveJob,
  createJob,
  failJob,
  updateProgress,
} from '@/lib/scraper';

/**
 * POST /api/admin/scraper/trigger
 * Creates a scrape job and delegates to the chunked cron worker.
 * Returns immediately so the UI never waits for the full scrape.
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

    // Update progress to show auth passed
    await updateProgress(job.id, {
      phase: 'authenticating',
      percent: 10,
      message: 'SpyOwl authenticated — starting scrape...',
      steps: [
        { id: 'init', label: 'Job created', status: 'done', ts: new Date().toISOString() },
        { id: 'auth', label: 'SpyOwl authenticated', status: 'done', ts: new Date().toISOString() },
        { id: 'scan', label: 'Queuing scrape worker...', status: 'active', ts: new Date().toISOString() },
      ],
    });

    // Delegate to the chunked cron worker (fire-and-forget)
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      await failJob(job.id, 'CRON_SECRET not configured — cannot start worker');
      return Response.json(
        { success: false, job_id: job.id, error: 'Server misconfigured: CRON_SECRET not set' },
        { status: 500 }
      );
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : null);

    if (!siteUrl) {
      await failJob(job.id, 'Cannot determine site URL for worker');
      return Response.json(
        { success: false, job_id: job.id, error: 'Server misconfigured: no site URL' },
        { status: 500 }
      );
    }

    const workerUrl = `${siteUrl}/api/cron/scrape?job=${job.id}&resume=0&chain=0`;

    // Fire-and-forget: start the chunked scrape via cron endpoint
    fetch(workerUrl, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(10000),
    }).catch(e => {
      console.error('[trigger] Failed to start scrape worker:', e.message);
    });

    console.log(`[trigger] Job ${job.id} created, delegated to worker`);

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
