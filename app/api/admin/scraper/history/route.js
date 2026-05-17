import { waitUntil } from '@vercel/functions';
import { supaFetch } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';
import { cleanupStaleJobs } from '@/lib/scraper';

// Default Vercel function timeout is 10s. Under DB contention (active
// scraper writing to sync_runs while this endpoint also queries it),
// the cleanup PATCH + history SELECT routinely blew past 10s,
// 504-ing the dashboard mid-scrape (production incident 2026-05-03).
// 60s matches the budget of the sister stats/brands/scraper routes
// (PR #26) so the dashboard's parallel fetches succeed or fail together.
export const maxDuration = 60;

/**
 * GET /api/admin/scraper/history
 * Returns recent scrape runs with stats
 */
export async function GET(request) {
  try {
    verifyAdmin(request);

    // Auto-cleanup stale jobs — fire-and-forget via waitUntil so its slow
    // PATCH (which has to scan sync_runs by jsonb path) never blocks the
    // user-facing render. The next /history call (8s later in the
    // dashboard's polling cadence) sees whatever cleanup did. If cleanup
    // takes 30s, that's fine — it doesn't 504 the dashboard.
    waitUntil(cleanupStaleJobs().catch(() => {}));

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const result = await supaFetch(
      `/sync_runs?select=id,status,trigger_type,geo_filter,started_at,finished_at,creatives_synced,brands_updated,new_creatives,new_brands,total_api,error_message,source,progress&order=started_at.desc&limit=${limit}&offset=${offset}`,
      { headers: { Prefer: 'count=exact' } }
    );

    const runs = result?.data || result || [];
    const total = result?.count || runs.length;

    // Check if there's currently a running job
    const activeJobs = runs.filter(r => r.status === 'running' || r.status === 'pending');

    // Calculate summary stats
    const completedRuns = runs.filter(r => r.status === 'completed');
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
      runs,
      total,
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
      headers: { Prefer: 'return=minimal' },
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
