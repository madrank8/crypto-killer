import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

const STALE_JOB_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

async function supaFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    Prefer: options.prefer || 'count=exact',
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, { method: options.method || 'GET', headers, body: options.body });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  if (options.method === 'PATCH') return { data: null, total: null };
  const data = await res.json();
  const range = res.headers.get('content-range');
  let total = null;
  if (range) {
    const m = range.match(/\/(\d+)$/);
    if (m) total = parseInt(m[1], 10);
  }
  return { data, total };
}

/**
 * Auto-fail jobs stuck in running/pending for over 1 hour.
 * This prevents a single orphaned job from blocking all future scrapes.
 */
async function cleanupStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS).toISOString();
  try {
    await supaFetch(
      `/sync_runs?status=in.("pending","running")&started_at=lt.${cutoff}`,
      {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: 'Auto-failed: job exceeded 1-hour timeout (SpyOwl never responded)',
        }),
      }
    );
  } catch (e) {
    console.error('Stale job cleanup failed:', e.message);
  }
}

/**
 * GET /api/admin/scraper/history
 * Returns recent scrape runs with stats
 */
export async function GET(request) {
  try {
    verifyAdmin(request);

    // Auto-cleanup stale jobs before returning history
    await cleanupStaleJobs();

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const { data: runs, total } = await supaFetch(
      `/sync_runs?select=id,status,trigger_type,geo_filter,started_at,finished_at,creatives_synced,brands_updated,new_creatives,new_brands,total_api,error_message,source,progress&order=started_at.desc&limit=${limit}&offset=${offset}`
    );

    // Check if there's currently a running job
    const activeJobs = (runs || []).filter(r => r.status === 'running' || r.status === 'pending');

    // Calculate summary stats
    const completedRuns = (runs || []).filter(r => r.status === 'completed');
    const totalCreativesSynced = completedRuns.reduce((sum, r) => sum + (r.creatives_synced || 0), 0);
    const totalBrandsUpdated = completedRuns.reduce((sum, r) => sum + (r.brands_updated || 0), 0);
    const avgDuration = completedRuns.length > 0
      ? Math.round(completedRuns.reduce((sum, r) => {
          if (r.started_at && r.finished_at) {
            return sum + (new Date(r.finished_at) - new Date(r.started_at)) / 1000;
          }
          return sum;
        }, 0) / completedRuns.length)
      : 0;

    return Response.json({
      runs: runs || [],
      total: total || 0,
      has_active: activeJobs.length > 0,
      active_job: activeJobs[0] || null,
      summary: {
        total_runs: total || 0,
        completed: completedRuns.length,
        failed: (runs || []).filter(r => r.status === 'failed').length,
        total_creatives_synced: totalCreativesSynced,
        total_brands_updated: totalBrandsUpdated,
        avg_duration_seconds: avgDuration,
      },
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/scraper/history
 * Cancel the currently active scrape job
 * Body (optional): { job_id: "uuid" }
 */
export async function DELETE(request) {
  try {
    verifyAdmin(request);

    const body = await request.json().catch(() => ({}));
    const jobId = body.job_id;

    let path;
    if (jobId) {
      path = `/sync_runs?id=eq.${jobId}&status=in.("pending","running")`;
    } else {
      path = `/sync_runs?status=in.("pending","running")`;
    }

    await supaFetch(path, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Manually cancelled by admin',
      }),
    });

    return Response.json({ success: true, message: 'Scrape job cancelled' });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
