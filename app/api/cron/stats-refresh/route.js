import { supaFetch } from '@/lib/supabase'
import { dedupeCelebrityList } from '@/lib/threat-score'
import { appendUpdateHistory, makeEntry, buildStatsDelta } from '@/lib/update-history'

/**
 * GET /api/cron/stats-refresh — the freshness engine (2026-07-08).
 *
 * Runs nightly at 02:00 UTC, two hours after /api/cron/scrape has ingested
 * new creatives and rebuild_brands() has refreshed brand aggregates. For
 * every published master review whose brand row moved since our last push,
 * it sends a LIGHTWEIGHT stats-only payload to Replit:
 *
 *   POST {REPLIT_SITE_URL}/api/sync/brand-stats
 *   { slug, stats, geo_pressure, data_refreshed_at, update_history? }
 *
 * Design decisions (owner-approved plan, 2026-07-08):
 *   - Stats-only, never full content: no full_article integrity checks to
 *     trip over, and it can never collide with an in-flight polish or an
 *     editor save (the lost-update class we hit that same day).
 *   - "Data refreshed" is SEPARATE from "article updated": pure stat ticks
 *     update the SSR'd freshness line + numbers on the live page but do NOT
 *     bump dateModified. Only a MATERIAL delta (new country, +10 creatives,
 *     +3 celebrities, velocity flip — see buildStatsDelta) writes a visible
 *     update_history entry, and THAT is what justifies a dateModified move.
 *     Silent date-bumping is the fake-freshness pattern our auditor and
 *     Google both punish.
 *   - Cap per run so a platform-wide scrape surge cannot blow the cron
 *     budget; the backlog drains on subsequent nights.
 *
 * Auth: same convention as polish-watchdog (CRON_SECRET or ADMIN_SECRET).
 */

const MAX_REVIEWS_PER_RUN = 30

export const maxDuration = 300

function buildStatsSnapshot(brand) {
  return {
    ad_creatives: brand.total_creatives || 0,
    countries_targeted: brand.total_geos || 0,
    celebrities_abused: dedupeCelebrityList(brand.celebrity_list || []).length,
    days_active: brand.lifespan_days || 0,
    weekly_velocity: brand.velocity_7d || 0,
    velocity_trend: brand.velocity_trend || null,
    first_detected: brand.first_seen_at ? String(brand.first_seen_at).slice(0, 10) : '',
    last_active: brand.last_seen_at ? String(brand.last_seen_at).slice(0, 10) : '',
  }
}

function buildGeoPressure(brand) {
  return Array.isArray(brand.geo_breakdown)
    ? brand.geo_breakdown
        .filter((g) => g && typeof g.geo === 'string' && g.geo.trim() && Number.isFinite(Number(g.n)))
        .slice(0, 5)
        .map((g) => ({
          code: g.geo.trim().toUpperCase(),
          ads: Number(g.n),
          share: Number.isFinite(Number(g.share)) ? Number(g.share) : 0,
        }))
    : []
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer' && !!process.env.CRON_SECRET && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer' && !!process.env.ADMIN_SECRET && token === process.env.ADMIN_SECRET
  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const replitUrl = process.env.REPLIT_SITE_URL
  const syncSecret = process.env.SYNC_SECRET
  if (!replitUrl || !syncSecret) {
    return Response.json({ error: 'REPLIT_SITE_URL / SYNC_SECRET not configured' }, { status: 500 })
  }

  try {
    // Published master reviews with their freshness bookkeeping.
    const reviews = await supaFetch(
      `/reviews?status=eq.published&is_master=eq.true` +
        `&select=id,slug,brand_id,stats_synced_at,last_stats_snapshot,update_history` +
        `&order=stats_synced_at.asc.nullsfirst&limit=200`,
    )
    if (!Array.isArray(reviews) || reviews.length === 0) {
      return Response.json({ success: true, pushed: 0, reason: 'no published reviews' })
    }

    const brandIds = [...new Set(reviews.map((r) => r.brand_id).filter(Boolean))]
    const brands = await supaFetch(
      `/scam_brands?id=in.(${brandIds.join(',')})` +
        `&select=id,slug,name,total_creatives,total_geos,celebrity_list,lifespan_days,velocity_7d,velocity_trend,first_seen_at,last_seen_at,geo_breakdown,updated_at`,
    )
    const brandById = Object.fromEntries((brands || []).map((b) => [b.id, b]))

    // Stale = brand aggregates moved since our last stats push.
    const stale = reviews.filter((r) => {
      const b = brandById[r.brand_id]
      if (!b) return false
      if (!r.stats_synced_at) return true
      return new Date(b.updated_at) > new Date(r.stats_synced_at)
    }).slice(0, MAX_REVIEWS_PER_RUN)

    const results = { pushed: 0, material_updates: 0, failed: 0, skipped: reviews.length - stale.length, items: [] }

    for (const review of stale) {
      const brand = brandById[review.brand_id]
      const stats = buildStatsSnapshot(brand)
      const geoPressure = buildGeoPressure(brand)
      const nowIso = new Date().toISOString()

      // Material-delta detection against the LAST SHIPPED snapshot (not the
      // brand row) so a slow drift eventually crosses the threshold instead
      // of being forever sliced into sub-threshold daily ticks.
      const delta = buildStatsDelta(review.last_stats_snapshot, stats)
      let updateHistory = null
      if (delta.material && review.last_stats_snapshot) {
        updateHistory = await appendUpdateHistory(
          review.id,
          makeEntry('stats_update', delta.summary),
        )
      }

      try {
        const res = await fetch(`${replitUrl}/api/sync/brand-stats`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${syncSecret}`,
          },
          body: JSON.stringify({
            slug: review.slug,
            stats,
            geo_pressure: geoPressure,
            data_refreshed_at: nowIso,
            // Only present when a material delta landed a visible entry —
            // Replit bumps dateModified IFF this key is present.
            ...(updateHistory ? { update_history: updateHistory } : {}),
          }),
          signal: AbortSignal.timeout(15000),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          // 404 = receiver not deployed yet (pre-handoff). Log once, keep
          // bookkeeping UNTOUCHED so the backlog re-drains after Replit ships.
          console.warn(`[stats-refresh] Replit rejected ${review.slug}: ${res.status} ${text.slice(0, 200)}`)
          results.failed++
          results.items.push({ slug: review.slug, status: res.status })
          continue
        }

        // Bookkeeping AFTER a successful push.
        await supaFetch(`/reviews?id=eq.${review.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            stats_synced_at: nowIso,
            last_stats_snapshot: stats,
          }),
        })

        results.pushed++
        if (updateHistory) results.material_updates++
        results.items.push({ slug: review.slug, status: 'ok', material: delta.material })
      } catch (pushErr) {
        console.warn(`[stats-refresh] push failed for ${review.slug}:`, pushErr?.message)
        results.failed++
        results.items.push({ slug: review.slug, status: 'error', error: pushErr?.message?.slice(0, 120) })
      }
    }

    return Response.json({ success: true, scanned: reviews.length, stale: stale.length, ...results })
  } catch (error) {
    console.error('[stats-refresh] error:', error)
    return Response.json({ error: error.message || 'stats-refresh failed' }, { status: 500 })
  }
}
