import { supaFetch } from './supabase'

// Count rows matching a PostgREST query without parsing the body.
// Inlined here (vs imported from a shared `supabaseCount` helper) so this
// module is independent of crypto-killer#21 — the two helpers will be
// reconciled in a follow-up cleanup once both PRs land. The implementation
// matches that PR's `supabaseCount` byte-for-byte.
async function countExact(path) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment variables')
  }
  const url = `${SUPABASE_URL}/rest/v1${path}`
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
    },
  })
  if (!response.ok) {
    const error = await response.text().catch(() => '')
    throw new Error(`Supabase count error: ${response.status} - ${error.slice(0, 200)}`)
  }
  const range = response.headers.get('content-range')
  if (!range) return 0
  const total = range.split('/')[1]
  const n = parseInt(total, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Compute the cross-cutting platform aggregates that the article writer's
 * `{{platform_stat:KEY}}` token system substitutes against on the live site.
 *
 * Same data shape as the `fetchPlatformIntelligence` helpers in
 * app/api/admin/content/{generate,fill}/route.js, but flattened (no nested
 * topScamScore object) for direct use as the /sync/platform-aggregates
 * payload. The two helpers will be reconciled to share this implementation
 * in a follow-up DRY PR.
 *
 * Returns null on transport / auth failure so callers can degrade
 * gracefully (e.g. a cron handler emits a 502 with the error rather than
 * pushing zero/null values that would clobber a previously-good row).
 */
export async function computePlatformAggregates() {
  const [totalBrandsTracked, totalCreativesAnalyzed, totalBrandsWithCelebrityAbuse] = await Promise.all([
    countExact('/scam_brands?select=id&limit=1'),
    countExact('/creatives?select=id&limit=1'),
    countExact('/scam_brands?select=id&limit=1&total_celebrities=gt.0'),
  ])

  // avgScamScore from a recency-ordered 500-row sample (less biased than
  // the score-DESC top-10 sample, which always averages ~95).
  const recentSample = await supaFetch(
    '/scam_brands?select=scam_score&order=updated_at.desc.nullslast&limit=500',
  )
  const sampleArr = Array.isArray(recentSample)
    ? recentSample.filter(b => typeof b.scam_score === 'number')
    : []
  const avgScamScore = sampleArr.length > 0
    ? Math.round(sampleArr.reduce((s, b) => s + b.scam_score, 0) / sampleArr.length)
    : null

  // Velocity-trend mode + top-scam outlier from the score-ordered top-10.
  // These are intentionally biased toward "headline outlier" signals.
  const topBrands = await supaFetch(
    '/scam_brands?select=name,scam_score,velocity_trend&order=scam_score.desc&limit=10',
  )
  const allBrands = Array.isArray(topBrands) ? topBrands : []
  const velocities = allBrands.map(b => b.velocity_trend).filter(Boolean)
  const topVelocityTrend = velocities.length > 0
    ? velocities.sort((a, b) => velocities.filter(v => v === b).length - velocities.filter(v => v === a).length)[0]
    : null
  const top = allBrands[0] || null

  return {
    totalBrandsTracked,
    totalCreativesAnalyzed,
    totalBrandsWithCelebrityAbuse,
    avgScamScore,
    topVelocityTrend,
    topScamBrandName: top?.name ?? null,
    topScamBrandScore: typeof top?.scam_score === 'number' ? top.scam_score : null,
  }
}
