import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth';

async function supaFetch(path) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    Prefer: 'count=exact',
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
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
 * GET /api/admin/scraper/history
 * Returns recent scrape runs with stats
 */
export async function GET(request) {
  try {
    verifyAdmin(request);

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const { data: runs, total } = await supaFetch(
      `/sync_runs?select=id,status,trigger_type,geo_filter,started_at,finished_at,creatives_synced,brands_updated,new_creatives,new_brands,total_api,error_message,source&order=started_at.desc&limit=${limit}&offset=${offset}`
    );

    // Check if there's currently a running job
    const activeJobs = (runs || []).filter(
      r => r.status === 'running' || r.status === 'pending'
    );

    // Calculate summary stats
    const completedRuns = (runs || []).filter(r => r.status === 'completed');
    const totalCreativesSynced = completedRuns.reduce(
      (sum, r) => sum + (r.creatives_synced || 0), 0
    );
    const totalBrandsUpdated = completedRuns.reduce(
      (sum, r) => sum + (r.brands_updated || 0), 0
    );
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
