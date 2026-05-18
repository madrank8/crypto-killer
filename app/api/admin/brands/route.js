import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

// V1 supported review locales — must stay in sync with the translation pipeline
// (lib/translate.js, when it ships) and the public /[locale]/review/[slug] route
// allowlist. Order matters for UI display order in the locale picker.
const SUPPORTED_LOCALES = ['en', 'it', 'es', 'de', 'fr', 'pt-BR']

// Map a SpyOwl land_language code (lowercase ISO-639-1) to the V1 review locale
// that should be pre-selected when the user clicks Generate Review. Anything not
// in this table (tr/ru/pl/ar/nl/cs/hr/ro/…) defaults to 'en' — V2 territory.
const LANG_TO_LOCALE = {
  en: 'en',
  it: 'it',
  es: 'es',
  de: 'de',
  fr: 'fr',
  // SpyOwl emits bare 'pt'; per V1 decision we route it to Brazilian PT.
  pt: 'pt-BR',
}

function suggestedLocale(topLang) {
  if (!topLang) return 'en'
  return LANG_TO_LOCALE[String(topLang).toLowerCase()] || 'en'
}

// Default Vercel function timeout is 10s. The brands list endpoint
// pages through scam_brands and joins review status — under Supabase
// contention (concurrent scraper, cron, etc.) it 500'd at 10s,
// leaving the dashboard's brand list stuck. 60s matches the budget
// of the sister stats route so the dashboard's parallel fetches
// succeed or fail together rather than partially rendering.
export const maxDuration = 60

/**
 * GET /api/admin/brands
 * Returns brands sorted by triage priority with filtering and pagination
 * Query params: sort, trend, review_status, q, limit, offset
 *   q — case-insensitive substring search on brand name (server-side)
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const sort = searchParams.get('sort') || 'creative_volume'
    const trend = searchParams.get('trend') // surging, rising, stable, declining, dead
    const reviewStatus = searchParams.get('review_status') // none, draft, published
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500)
    const page = parseInt(searchParams.get('page') || '1')
    const offset = (page - 1) * limit

    // Build Supabase query
    let query = `/scam_brands?select=id,slug,name,scam_score,total_creatives,total_geos,total_celebrities,velocity_7d,velocity_trend,status,first_seen_at,last_seen_at,last_synced_at,top_geo,top_lang,geo_breakdown`

    // Add filters based on trend
    if (trend && trend !== 'all') {
      query += `&velocity_trend=eq.${trend}`
    }

    // Server-side name search via PostgREST ilike. PostgREST uses `*` as the
    // wildcard char; escape any % / * the user types so they can't break out
    // of the pattern, and URL-encode the final value.
    if (q) {
      const safe = q.replace(/[%*]/g, ' ')
      query += `&name=ilike.${encodeURIComponent(`*${safe}*`)}`
    }

    // Add ordering
    const orderMap = {
      creative_volume: 'total_creatives.desc',
      velocity: 'velocity_7d.desc',
      scam_score: 'scam_score.desc',
    }
    const orderBy = orderMap[sort] || orderMap.creative_volume
    query += `&order=${orderBy}&limit=${limit}&offset=${offset}`

    // Fetch brands
    const brands = await supabaseRequest(query)

    if (!Array.isArray(brands)) {
      return Response.json(
        { error: 'Failed to fetch brands' },
        { status: 500 }
      )
    }

    // Fetch ALL reviews with pagination (Supabase caps at 1000 per request)
    const allReviews = []
    let reviewOffset = 0
    const reviewPageSize = 1000
    while (true) {
      const batch = await supabaseRequest(
        `/reviews?select=id,brand_id,status&limit=${reviewPageSize}&offset=${reviewOffset}`
      )
      if (!Array.isArray(batch) || batch.length === 0) break
      allReviews.push(...batch)
      if (batch.length < reviewPageSize) break
      reviewOffset += reviewPageSize
    }

    // Build review lookup map (prefer published over draft if multiple exist)
    const reviewMap = {}
    if (allReviews.length > 0) {
      allReviews.forEach((review) => {
        const existing = reviewMap[review.brand_id]
        if (!existing || (review.status === 'published' && existing.review_status !== 'published')) {
          reviewMap[review.brand_id] = {
            has_review: true,
            review_id: review.id,
            review_status: review.status,
          }
        }
      })
    }

    // "Active on SpyOwl" cutoff — re-seen within the last 3 days.
    // Computed in the API rather than as a generated column because Postgres
    // disallows non-IMMUTABLE functions (now()) in GENERATED expressions.
    const activeCutoff = Date.now() - 3 * 24 * 60 * 60 * 1000

    // Enrich brands with review data, renaming fields for frontend
    let enrichedBrands = brands.map((brand) => ({
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      scam_score: brand.scam_score,
      total_creatives: brand.total_creatives,
      velocity_7d: brand.velocity_7d,
      trend: brand.velocity_trend,
      geo_count: brand.total_geos,
      celebrity_count: brand.total_celebrities,
      status: brand.status,
      first_seen_at: brand.first_seen_at,
      last_seen_at: brand.last_seen_at,
      last_synced_at: brand.last_synced_at,
      is_active: brand.last_synced_at
        ? new Date(brand.last_synced_at).getTime() >= activeCutoff
        : false,
      // ─── Locale targeting (Phase 0) ────────────────────────────────
      // top_geo / top_lang are the most-frequent country + language across
      // the brand's creatives, computed by rebuild_brands().
      // suggested_locale maps top_lang → one of SUPPORTED_LOCALES so the UI
      // can pre-select the right language without duplicating the mapping.
      top_geo: brand.top_geo || null,
      top_lang: brand.top_lang || null,
      geo_breakdown: brand.geo_breakdown || [],
      suggested_locale: suggestedLocale(brand.top_lang),
      // ────────────────────────────────────────────────────────────────
      has_review: reviewMap[brand.id]?.has_review || false,
      review_id: reviewMap[brand.id]?.review_id || null,
      review_status: reviewMap[brand.id]?.review_status || null,
    }))

    // Filter by review_status if provided
    if (reviewStatus && reviewStatus !== 'all') {
      if (reviewStatus === 'none') {
        enrichedBrands = enrichedBrands.filter((b) => !b.has_review)
      } else if (reviewStatus === 'draft') {
        enrichedBrands = enrichedBrands.filter(
          (b) => b.review_status === 'draft'
        )
      } else if (reviewStatus === 'published') {
        enrichedBrands = enrichedBrands.filter(
          (b) => b.review_status === 'published'
        )
      }
    }

    return Response.json({
      brands: enrichedBrands,
      has_more: brands.length === limit,
      total: enrichedBrands.length,
      supported_locales: SUPPORTED_LOCALES,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
