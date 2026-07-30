import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/funnel-stats
 * Returns aggregated statistics from real scrape data for the Funnels dashboard.
 * All numbers come directly from the database — no hardcoded values.
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    // Fire all queries in parallel for speed
    const [
      brandsRaw,
      creativesCount,
      lastScrape,
      scrapeHistory,
      geoBreakdown,
      celebCount,
      reviewStats,
    ] = await Promise.all([
      // 1. All brands — we aggregate client-side for trend/score breakdown
      supabaseRequest(
        '/scam_brands?select=velocity_trend,scam_score,total_creatives,total_geos,total_celebrities,velocity_7d'
      ),
      // 2. Total creatives count
      supabaseRequest('/creatives?select=id&limit=1&offset=0', {
        headers: { Prefer: 'count=exact' },
      }),
      // 3. Last finished scrape (completed or completed_with_errors)
      supabaseRequest(
        '/sync_runs?status=in.(completed,completed_with_errors)&order=finished_at.desc&limit=1&select=id,started_at,finished_at,creatives_synced,brands_updated,total_api,new_creatives,status,error_message'
      ),
      // 4. Last 10 scrapes for history sparkline
      supabaseRequest(
        '/sync_runs?order=started_at.desc&limit=10&select=id,status,started_at,finished_at,creatives_synced,brands_updated,total_api,trigger_type,error_message'
      ),
      // 5. Top geos from creatives (raw SQL via RPC would be ideal, but we approximate from brands)
      supabaseRequest(
        '/scam_brands?select=geo_list&limit=500&order=total_creatives.desc'
      ),
      // 6. Unique celebrity count from brands
      supabaseRequest(
        '/scam_brands?select=celebrity_list&total_celebrities=gt.0&limit=500&order=total_celebrities.desc'
      ),
      // 7. Review stats
      supabaseRequest('/reviews?select=id,status'),
    ])

    // ─── Aggregate brand stats ───
    const brands = Array.isArray(brandsRaw) ? brandsRaw : []
    const totalBrands = brands.length

    const trendCounts = { surging: 0, rising: 0, stable: 0, declining: 0, dead: 0 }
    const trendAds = { surging: 0, rising: 0, stable: 0, declining: 0, dead: 0 }
    let totalAds = 0
    let totalVelocity = 0
    let highThreat = 0 // score >= 70
    let medThreat = 0  // score 50-69
    let lowThreat = 0  // score < 50

    for (const b of brands) {
      const trend = b.velocity_trend || 'dead'
      if (trendCounts[trend] !== undefined) {
        trendCounts[trend]++
        trendAds[trend] += b.total_creatives || 0
      }
      totalAds += b.total_creatives || 0
      totalVelocity += b.velocity_7d || 0
      const score = b.scam_score || 0
      if (score >= 70) highThreat++
      else if (score >= 50) medThreat++
      else lowThreat++
    }

    const activeBrands = totalBrands - trendCounts.dead

    // ─── Geo breakdown from brand geo_lists ───
    const geoCounts = {}
    if (Array.isArray(geoBreakdown)) {
      for (const b of geoBreakdown) {
        if (Array.isArray(b.geo_list)) {
          for (const geo of b.geo_list) {
            if (geo) geoCounts[geo] = (geoCounts[geo] || 0) + 1
          }
        }
      }
    }
    const topGeos = Object.entries(geoCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([geo, count]) => ({ geo, count }))

    // ─── Celebrity stats ───
    const celebSet = new Set()
    if (Array.isArray(celebCount)) {
      for (const b of celebCount) {
        if (Array.isArray(b.celebrity_list)) {
          for (const c of b.celebrity_list) {
            if (c) celebSet.add(c)
          }
        }
      }
    }

    // ─── Review coverage ───
    const reviews = Array.isArray(reviewStats) ? reviewStats : []
    const publishedReviews = reviews.filter(r => r.status === 'published').length
    const draftReviews = reviews.filter(r => r.status === 'draft').length
    const reviewCoverage = totalBrands > 0 ? ((reviews.length / totalBrands) * 100).toFixed(1) : '0'

    // ─── Last scrape ───
    const last = Array.isArray(lastScrape) && lastScrape.length > 0 ? lastScrape[0] : null

    // ─── Scrape history ───
    const history = Array.isArray(scrapeHistory) ? scrapeHistory.map(s => ({
      id: s.id,
      status: s.status,
      started_at: s.started_at,
      finished_at: s.finished_at,
      creatives_synced: s.creatives_synced || 0,
      brands_updated: s.brands_updated || 0,
      total_api: s.total_api || 0,
      trigger_type: s.trigger_type,
      error_message: s.error_message,
    })) : []

    return Response.json({
      overview: {
        total_creatives: totalAds,
        total_brands: totalBrands,
        active_brands: activeBrands,
        unique_geos: Object.keys(geoCounts).length || topGeos.length,
        unique_celebrities: celebSet.size,
        total_velocity: totalVelocity,
        review_coverage: parseFloat(reviewCoverage),
      },
      threat_levels: {
        high: highThreat,
        medium: medThreat,
        low: lowThreat,
      },
      trends: {
        counts: trendCounts,
        ads: trendAds,
      },
      reviews: {
        total: reviews.length,
        published: publishedReviews,
        draft: draftReviews,
        unreviewed: totalBrands - reviews.length,
      },
      top_geos: topGeos,
      last_scrape: last ? {
        finished_at: last.finished_at,
        creatives_synced: last.creatives_synced,
        brands_updated: last.brands_updated,
        total_api: last.total_api,
      } : null,
      scrape_history: history,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
