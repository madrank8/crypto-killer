import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * Lightweight Supabase REST helper with Prefer: count=exact support
 */
async function supaFetch(path, { head = false, count = false, headers: extra = {} } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  }
  if (count) {
    headers['Prefer'] = headers['Prefer']
      ? headers['Prefer'] + ', count=exact'
      : 'count=exact'
  }

  const url = `${SUPABASE_URL}/rest/v1${path}`
  const res = await fetch(url, { method: head ? 'HEAD' : 'GET', headers })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Supabase ${res.status}: ${error}`)
  }

  let totalCount = null
  const range = res.headers.get('content-range')
  if (range) {
    const match = range.match(/\/(\d+)$/)
    if (match) totalCount = parseInt(match[1], 10)
  }

  if (head) return { data: null, count: totalCount }
  const text = await res.text()
  const data = text ? JSON.parse(text) : []
  return { data, count: totalCount }
}

/**
 * Paginate through ALL rows from a Supabase REST endpoint.
 * Supabase caps each request at 1000 rows regardless of Range header,
 * so we must page through in batches.
 */
async function fetchAllRows(basePath, selectFields, pageSize = 1000) {
  const allRows = []
  let offset = 0
  while (true) {
    const separator = basePath.includes('?') ? '&' : '?'
    const path = `${basePath}${separator}select=${selectFields}&limit=${pageSize}&offset=${offset}`
    const { data } = await supaFetch(path)
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

/**
 * GET /api/admin/stats
 * Returns rich dashboard KPIs: counts, velocity breakdown, pipeline stats, recent activity
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    // Counts via HEAD (fast, exact) + paginated full data for breakdowns
    const [
      brandsCount,
      creativesCount,
      brands,
      reviews,
    ] = await Promise.all([
      supaFetch('/scam_brands?select=id', { head: true, count: true }),
      supaFetch('/creatives?select=id', { head: true, count: true }),
      fetchAllRows('/scam_brands', 'id,velocity_7d,velocity_trend,scam_score'),
      fetchAllRows('/reviews', 'id,brand_id,status,updated_at,published_at'),
    ])

    // ── Core KPIs ──
    const totalBrands = brandsCount.count || brands.length
    const totalCreatives = creativesCount.count || 0
    const activeBrands = brands.filter(b => b.velocity_7d > 0).length

    // ── Review Pipeline ──
    const publishedReviews = reviews.filter(r => r.status === 'published').length
    const draftReviews = reviews.filter(r => r.status === 'draft').length
    const totalReviews = reviews.length
    const brandsWithReview = new Set(reviews.map(r => r.brand_id)).size
    const brandsWithoutReview = totalBrands - brandsWithReview

    // ── Velocity Breakdown ──
    const velocityBreakdown = {}
    brands.forEach(b => {
      const trend = b.velocity_trend || 'unknown'
      velocityBreakdown[trend] = (velocityBreakdown[trend] || 0) + 1
    })

    // ── Score Distribution ──
    const scoreDistribution = { critical: 0, high: 0, medium: 0, low: 0 }
    brands.forEach(b => {
      const score = b.scam_score || 0
      if (score >= 80) scoreDistribution.critical++
      else if (score >= 60) scoreDistribution.high++
      else if (score >= 40) scoreDistribution.medium++
      else scoreDistribution.low++
    })

    // ── Recent Review Activity (last 10) ──
    const recentActivity = reviews
      .filter(r => r.updated_at)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 10)
      .map(r => ({
        id: r.id,
        brand_id: r.brand_id,
        status: r.status,
        updated_at: r.updated_at,
        published_at: r.published_at,
      }))

    // ── High-Priority Unreviewed (surging/rising, high score, no review) ──
    const reviewedBrandIds = new Set(reviews.map(r => r.brand_id))
    const highPriorityCount = brands.filter(b =>
      !reviewedBrandIds.has(b.id) &&
      (b.velocity_trend === 'surging' || b.velocity_trend === 'rising') &&
      (b.scam_score || 0) >= 60
    ).length

    return Response.json({
      // Core
      total_brands: totalBrands,
      total_creatives: totalCreatives,
      active_brands: activeBrands,

      // Pipeline
      published_reviews: publishedReviews,
      draft_reviews: draftReviews,
      total_reviews: totalReviews,
      brands_with_review: brandsWithReview,
      brands_without_review: brandsWithoutReview,

      // Velocity
      velocity_breakdown: velocityBreakdown,

      // Score
      score_distribution: scoreDistribution,

      // Priority
      high_priority_unreviewed: highPriorityCount,

      // Recent
      recent_activity: recentActivity,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
