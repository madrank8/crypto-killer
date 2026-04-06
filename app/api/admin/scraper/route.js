import { supaFetch, fetchAllRows } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { SPYOWL_API, getSpyOwlCookie } from '@/lib/scraper'

async function getSpyOwlStatus() {
  try {
    // Get cookie + age info from settings
    const settings = await supaFetch('/settings?key=eq.spyowl_cookie&select=value,updated_at');
    const cookieValue = settings?.[0]?.value || '';
    const updatedAt = settings?.[0]?.updated_at || null;
    if (!cookieValue) return { connected: false, cookie_age_hours: null, updated_at: null };

    const cookie = await getSpyOwlCookie();
    const res = await fetch(`${SPYOWL_API}/user/me`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5000),
    });
    const ageMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : null;
    return {
      connected: res.ok,
      cookie_age_hours: ageMs ? Math.round(ageMs / 3600000) : null,
      updated_at: updatedAt,
    };
  } catch {
    return { connected: false, cookie_age_hours: null, updated_at: null };
  }
}

export async function GET(request) {
  try {
    verifyAdmin(request);

    const [
      brandsCount,
      creativesCount,
      spyowlStatus,
      brands,
      recentBrands,
      creatives,
    ] = await Promise.all([
      supaFetch('/scam_brands?select=id', { method: 'HEAD', headers: { Prefer: 'count=exact' } }),
      supaFetch('/creatives?select=id', { method: 'HEAD', headers: { Prefer: 'count=exact' } }),
      getSpyOwlStatus(),
      fetchAllRows('/scam_brands', 'id,name,slug,velocity_7d,velocity_trend,total_creatives,total_geos,total_celebrities,scam_score,first_seen_at,last_seen_at,created_at'),
      supaFetch('/scam_brands?select=id,name,slug,total_creatives,velocity_7d,scam_score,created_at&order=created_at.desc&limit=20'),
      supaFetch('/creatives?select=id,created_at&order=created_at.desc&limit=1'),
    ]);

    const totalBrands = brandsCount?.count || brands.length;
    const totalCreatives = creativesCount?.count || 0;

    const now = new Date();
    const oneDayAgo = new Date(now - 86400000);
    const sevenDaysAgo = new Date(now - 7 * 86400000);
    const thirtyDaysAgo = new Date(now - 30 * 86400000);

    const brandsLast24h = brands.filter(b => b.created_at && new Date(b.created_at) > oneDayAgo).length;
    const brandsLast7d = brands.filter(b => b.created_at && new Date(b.created_at) > sevenDaysAgo).length;
    const brandsLast30d = brands.filter(b => b.created_at && new Date(b.created_at) > thirtyDaysAgo).length;

    const activeBrands = brands.filter(b => b.velocity_7d > 0);
    const surgingBrands = brands.filter(b => b.velocity_trend === 'surging');
    const risingBrands = brands.filter(b => b.velocity_trend === 'rising');
    const deadBrands = brands.filter(b => b.velocity_trend === 'dead');

    const avgCreativesPerBrand = totalBrands > 0 ? Math.round(totalCreatives / totalBrands) : 0;

    let totalGeoEntries = 0;
    brands.forEach(b => {
      if (b.total_geos > 0) totalGeoEntries += b.total_geos;
    });
    const brandsWithCelebs = brands.filter(b => b.total_celebrities > 0).length;
    const totalCelebMentions = brands.reduce((sum, b) => sum + (b.total_celebrities || 0), 0);

    const lastCreativeAt = creatives?.[0]?.created_at || null;
    const staleBrands = brands.filter(b => {
      if (!b.last_seen_at) return false;
      return new Date(b.last_seen_at) < sevenDaysAgo && b.velocity_trend !== 'dead';
    }).length;

    const unscoredBrands = brands.filter(b => !b.scam_score || b.scam_score === 0).length;
    const highScoreBrands = brands.filter(b => b.scam_score >= 80).length;

    const dailyIngestion = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const count = brands.filter(b => {
        if (!b.created_at) return false;
        const d = new Date(b.created_at);
        return d >= dayStart && d < dayEnd;
      }).length;
      dailyIngestion.push({
        date: dayStart.toISOString().split('T')[0],
        brands: count,
      });
    }

    const topSurging = surgingBrands
      .sort((a, b) => (b.velocity_7d || 0) - (a.velocity_7d || 0))
      .slice(0, 10)
      .map(b => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        velocity_7d: b.velocity_7d,
        total_creatives: b.total_creatives,
        scam_score: b.scam_score,
        total_geos: b.total_geos,
        total_celebrities: b.total_celebrities,
      }));

    const recentlyDiscovered = (recentBrands || []).map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      total_creatives: b.total_creatives,
      velocity_7d: b.velocity_7d,
      scam_score: b.scam_score,
      created_at: b.created_at,
    }));

    return Response.json({
      spyowl: spyowlStatus,
      total_brands: totalBrands,
      total_creatives: totalCreatives,
      avg_creatives_per_brand: avgCreativesPerBrand,
      ingestion: {
        last_24h: brandsLast24h,
        last_7d: brandsLast7d,
        last_30d: brandsLast30d,
        last_creative_at: lastCreativeAt,
        daily_trend: dailyIngestion,
      },
      activity: {
        active: activeBrands.length,
        surging: surgingBrands.length,
        rising: risingBrands.length,
        dead: deadBrands.length,
        stale: staleBrands,
      },
      quality: {
        unscored: unscoredBrands,
        high_score: highScoreBrands,
        with_celebrities: brandsWithCelebs,
        total_celeb_mentions: totalCelebMentions,
        total_geo_entries: totalGeoEntries,
      },
      top_surging: topSurging,
      recently_discovered: recentlyDiscovered,
    });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
