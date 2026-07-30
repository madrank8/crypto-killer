import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { buildReliabilityMetrics } from '@/lib/sync-runs-status'

export const maxDuration = 30

/**
 * GET /api/admin/analytics/content-ops
 *
 * Internal content-operations analytics computed from existing tables:
 *  - publish velocity (reviews + articles per ISO week, trailing 12 weeks)
 *  - translation coverage per locale vs published masters
 *  - scraper health (recent sync_runs)
 *  - pipeline status + staleness (oldest un-updated published pieces)
 */

function weekKey(dateStr) {
  const d = new Date(dateStr)
  // ISO week: Thursday trick
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const [reviews, content, translations, syncRuns, regenQueue] = await Promise.all([
      supabaseRequest(
        '/reviews?select=id,status,published_at,updated_at,word_count,locale,is_master,generation_status,slug,title&limit=2000',
        { useServiceRole: true }
      ),
      supabaseRequest(
        '/content?select=id,status,published_at,updated_at,word_count,content_type,slug,title&limit=2000',
        { useServiceRole: true }
      ),
      supabaseRequest(
        '/review_translations?select=id,locale,status,review_id&limit=5000',
        { useServiceRole: true }
      ),
      supabaseRequest(
        '/sync_runs?select=started_at,finished_at,status,new_creatives,creatives_synced,updated_creatives,new_brands,brands_updated,total_api,trigger_type,error_message,source&order=started_at.desc&limit=50',
        { useServiceRole: true }
      ),
      supabaseRequest(
        '/regen_queue?select=slug,priority,status,reason,note,last_error,attempts,updated_at&order=priority.asc&limit=50',
        { useServiceRole: true }
      ).catch(() => []),
    ])

    // ─── Publish velocity: trailing 12 ISO weeks ───
    const cutoff = Date.now() - 12 * 7 * 86400000
    const velocity = new Map()
    const bump = (dateStr, field) => {
      if (!dateStr || new Date(dateStr).getTime() < cutoff) return
      const wk = weekKey(dateStr)
      const row = velocity.get(wk) || { week: wk, reviews: 0, articles: 0 }
      row[field] += 1
      velocity.set(wk, row)
    }
    for (const r of reviews || []) if (r.published_at) bump(r.published_at, 'reviews')
    for (const c of content || []) if (c.published_at) bump(c.published_at, 'articles')
    const publishVelocity = [...velocity.values()].sort((a, b) => a.week.localeCompare(b.week))

    // ─── Pipeline status ───
    const countBy = (rows, field) => {
      const m = {}
      for (const r of rows || []) m[r[field] || '(none)'] = (m[r[field] || '(none)'] || 0) + 1
      return m
    }
    const masters = (reviews || []).filter((r) => r.is_master !== false)
    const publishedMasters = masters.filter((r) => r.status === 'published')

    // ─── Translation coverage per locale ───
    const locales = {}
    for (const t of translations || []) {
      const loc = t.locale || '(none)'
      locales[loc] = locales[loc] || { total: 0, published: 0 }
      locales[loc].total += 1
      if (t.status === 'published') locales[loc].published += 1
    }
    const translationCoverage = Object.entries(locales)
      .map(([locale, v]) => ({
        locale,
        translated: v.total,
        published: v.published,
        masters: publishedMasters.length,
        coverage: publishedMasters.length ? v.published / publishedMasters.length : 0,
      }))
      .sort((a, b) => b.published - a.published)

    // ─── Staleness: published pieces longest without an update ───
    const staleness = [...publishedMasters]
      .map((r) => ({
        slug: r.slug,
        title: r.title,
        updated_at: r.updated_at,
        ageDays: Math.floor((Date.now() - new Date(r.updated_at || r.published_at).getTime()) / 86400000),
      }))
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 10)

    // ─── Word counts ───
    const sumWords = (rows) => (rows || []).reduce((s, r) => s + (r.word_count || 0), 0)

    return Response.json({
      publishVelocity,
      pipeline: {
        reviews: countBy(reviews, 'status'),
        reviewGeneration: countBy(reviews, 'generation_status'),
        content: countBy(content, 'status'),
      },
      totals: {
        reviews: (reviews || []).length,
        publishedReviews: publishedMasters.length,
        articles: (content || []).length,
        publishedArticles: (content || []).filter((c) => c.status === 'published').length,
        translations: (translations || []).length,
        reviewWords: sumWords(reviews),
        articleWords: sumWords(content),
      },
      translationCoverage,
      staleness,
      // Content-maintenance engine (2026-07-05): auto-regeneration queue
      maintenanceQueue: {
        counts: (regenQueue || []).reduce((m, q) => {
          m[q.status] = (m[q.status] || 0) + 1
          return m
        }, {}),
        items: (regenQueue || []).filter((q) => !['published', 'skipped'].includes(q.status)).slice(0, 15),
        recentPublished: (regenQueue || []).filter((q) => q.status === 'published').slice(0, 5),
      },
      scraper: {
        runs: (syncRuns || []).slice(0, 20).map((r) => ({
          started_at: r.started_at,
          finished_at: r.finished_at,
          status: r.status,
          new_creatives: r.new_creatives,
          updated_creatives: r.updated_creatives,
          creatives_synced: r.creatives_synced,
          new_brands: r.new_brands,
          brands_updated: r.brands_updated,
          total_api: r.total_api,
          trigger_type: r.trigger_type,
          source: r.source,
          error_message: r.error_message,
          durationSec:
            r.finished_at && r.started_at
              ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)
              : null,
        })),
        reliability: buildReliabilityMetrics(syncRuns || [], { windowDays: 30, cronMissHours: 25 }),
      },
    })
  } catch (err) {
    console.error('[admin/analytics/content-ops]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
