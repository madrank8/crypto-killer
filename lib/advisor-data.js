/**
 * Advisor snapshot builder.
 *
 * Assembles a compact, pre-aggregated JSON snapshot of every analytics
 * domain for the AI advisor. Top-N only, numbers only — never raw rows —
 * so the model prompt stays ~10-15k tokens regardless of data growth.
 */

import { supabaseRequest } from './supabase'

function rpc(fn, args) {
  return supabaseRequest(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
}

const round = (n, d = 3) => (n == null ? null : +(+n).toFixed(d))

/* ─── Traffic (analytics_events RPCs) ─── */
async function trafficSection(days) {
  const [summary, timeseries, pages, referrers, countries, clicks] = await Promise.all([
    rpc('analytics_summary', { p_days: days }),
    rpc('analytics_timeseries', { p_days: days }),
    rpc('analytics_top', { p_days: days, p_dim: 'path', p_limit: 10 }),
    rpc('analytics_top', { p_days: days, p_dim: 'referrer_host', p_limit: 8 }),
    rpc('analytics_top', { p_days: days, p_dim: 'country', p_limit: 8 }),
    rpc('analytics_top_clicks', { p_days: days, p_limit: 8 }),
  ])
  return {
    summary,
    daily: (timeseries || []).map((r) => ({ d: r.day, pv: +r.pageviews, v: +r.visitors })),
    top_pages: pages,
    referrers,
    countries,
    outbound_clicks: clicks,
  }
}

/* ─── Search (gsc_daily) ─── */
async function searchSection(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const prevSince = new Date(Date.now() - days * 2 * 86400000).toISOString().slice(0, 10)

  const [pageRows, queryRows, prevQueryRows] = await Promise.all([
    supabaseRequest(
      `/gsc_daily?dimension=eq.page&date=gte.${since}&select=date,key,clicks,impressions,position&limit=20000`,
      { useServiceRole: true }
    ),
    supabaseRequest(
      `/gsc_daily?dimension=eq.query&date=gte.${since}&select=key,clicks,impressions,position&limit=20000`,
      { useServiceRole: true }
    ),
    supabaseRequest(
      `/gsc_daily?dimension=eq.query&date=gte.${prevSince}&date=lt.${since}&select=key,clicks,impressions,position&limit=20000`,
      { useServiceRole: true }
    ),
  ])

  const agg = (rows) => {
    const m = new Map()
    for (const r of rows || []) {
      const c = m.get(r.key) || { key: r.key, clicks: 0, impressions: 0, posSum: 0, posW: 0 }
      c.clicks += r.clicks
      c.impressions += r.impressions
      c.posSum += (r.position || 0) * r.impressions
      c.posW += r.impressions
      m.set(r.key, c)
    }
    return [...m.values()].map((r) => ({
      key: r.key,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: round(r.impressions ? r.clicks / r.impressions : 0),
      position: round(r.posW ? r.posSum / r.posW : null, 1),
    }))
  }

  const pages = agg(pageRows)
  const queries = agg(queryRows)
  const prevQueries = new Map(agg(prevQueryRows).map((q) => [q.key, q]))

  // CTR opportunities: real impressions, weak CTR → title/meta candidates
  const ctr_opportunities = queries
    .filter((q) => q.impressions >= 50 && q.ctr < 0.015)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)

  // Position movers vs previous window (only where both periods have data)
  const movers = queries
    .map((q) => {
      const prev = prevQueries.get(q.key)
      if (!prev || !prev.position || !q.position) return null
      const delta = round(prev.position - q.position, 1) // positive = improved
      return Math.abs(delta) >= 3 ? { key: q.key, position: q.position, delta, impressions: q.impressions } : null
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10)

  // Striking distance: page-1 fringe (positions 8-20) with impressions
  const striking_distance = queries
    .filter((q) => q.position >= 8 && q.position <= 20 && q.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)

  const totals = pages.reduce(
    (a, p) => ({ clicks: a.clicks + p.clicks, impressions: a.impressions + p.impressions }),
    { clicks: 0, impressions: 0 }
  )

  return {
    totals: { ...totals, ctr: round(totals.impressions ? totals.clicks / totals.impressions : 0) },
    top_pages: pages.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10),
    top_queries: queries.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10),
    ctr_opportunities,
    position_movers: movers,
    striking_distance,
  }
}

/* ─── Content ops ─── */
async function contentSection() {
  const [reviews, content, translations] = await Promise.all([
    supabaseRequest(
      '/reviews?select=slug,title,status,published_at,updated_at,locale,is_master,target_keyword&limit=2000',
      { useServiceRole: true }
    ),
    supabaseRequest('/content?select=slug,title,status,published_at,content_type&limit=2000', {
      useServiceRole: true,
    }),
    supabaseRequest('/review_translations?select=locale,status&limit=5000', { useServiceRole: true }),
  ])

  const masters = (reviews || []).filter((r) => r.is_master !== false)
  const published = masters.filter((r) => r.status === 'published')
  const stale = published
    .map((r) => ({
      slug: r.slug,
      days_since_update: Math.floor((Date.now() - new Date(r.updated_at || r.published_at)) / 86400000),
    }))
    .sort((a, b) => b.days_since_update - a.days_since_update)
    .slice(0, 8)

  const locales = {}
  for (const t of translations || []) {
    locales[t.locale] = locales[t.locale] || { published: 0, total: 0 }
    locales[t.locale].total++
    if (t.status === 'published') locales[t.locale].published++
  }

  const last30 = Date.now() - 30 * 86400000
  return {
    published_reviews: published.length,
    draft_reviews: masters.filter((r) => r.status !== 'published').length,
    published_articles: (content || []).filter((c) => c.status === 'published').length,
    published_last_30d:
      published.filter((r) => new Date(r.published_at) > last30).length +
      (content || []).filter((c) => c.published_at && new Date(c.published_at) > last30).length,
    translation_coverage: Object.entries(locales).map(([locale, v]) => ({
      locale,
      published: v.published,
      of_masters: published.length,
    })),
    stalest_published: stale,
  }
}

/* ─── Opportunity radar: hot brands without reviews ─── */
async function opportunitySection() {
  const [brands, reviews] = await Promise.all([
    supabaseRequest(
      '/scam_brands?select=id,slug,name,velocity_7d,velocity_trend,total_creatives,total_geos,total_celebrities,scam_score,top_geo&velocity_trend=in.(surging,rising,new)&order=velocity_7d.desc&limit=40',
      { useServiceRole: true }
    ),
    supabaseRequest('/reviews?select=brand_id,slug,status&limit=2000', { useServiceRole: true }),
  ])
  const reviewedBrandIds = new Set((reviews || []).map((r) => r.brand_id).filter(Boolean))

  return {
    hot_brands_without_review: (brands || [])
      .filter((b) => !reviewedBrandIds.has(b.id))
      .slice(0, 12)
      .map((b) => ({
        slug: b.slug,
        name: b.name,
        velocity_7d: b.velocity_7d,
        trend: b.velocity_trend,
        creatives: b.total_creatives,
        geos: b.total_geos,
        celebrities: b.total_celebrities,
        top_geo: b.top_geo,
      })),
  }
}

/**
 * Build the full advisor snapshot.
 * @param {number} days - analysis window (default 28)
 */
export async function buildAdvisorSnapshot(days = 28) {
  const [traffic, search, content, opportunities] = await Promise.all([
    trafficSection(days).catch((e) => ({ error: e.message })),
    searchSection(days).catch((e) => ({ error: e.message })),
    contentSection().catch((e) => ({ error: e.message })),
    opportunitySection().catch((e) => ({ error: e.message })),
  ])

  return {
    generated_at: new Date().toISOString(),
    period_days: days,
    site: {
      name: 'CryptoKiller (cryptokiller.org)',
      what: 'Independent crypto scam intelligence: evidence-based investigations/reviews of scam brands (pig butchering, rug pulls, fake exchanges, deepfake celebrity endorsements), threat scores 0-100, powered by real-time ad surveillance (SpyOwl) of 12k+ scam brands.',
      locales: 'en master + it/es/pt/fr/de translations (V1)',
      goals: 'Grow organic search traffic, become the cited authority for crypto scam checks, publish reviews for trending scams before competitors.',
    },
    traffic,
    search,
    content,
    opportunities,
  }
}
