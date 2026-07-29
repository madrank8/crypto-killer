import { NextResponse } from 'next/server'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { supaFetch } from '@/lib/supabase'
import { fetchKeywordOverview } from '@/lib/keyword-data'
import { isAhrefsAvailable, fetchAhrefsKeywordOverview } from '@/lib/topical-map/ahrefs'
import { computeTopicPriorityScore } from '@/lib/content-prompts'
import { keywordMetricProvenance } from '@/lib/topical-map/provenance'

export const maxDuration = 120

/**
 * POST /api/admin/topical-map/maps/[id]/enrich-metrics
 *
 * Ground blank / spreadsheet-sourced volume+KD via DataForSEO (+ Ahrefs when available).
 * Recomputes priority_score. Does NOT rewrite publication_wave unless
 * body.reshuffle_waves === true (default false).
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params

    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const reshuffleWaves = body.reshuffle_waves === true
    const country = body.country || 'us'
    const locationName = body.locationName || 'United States'
    const languageCode = body.languageCode || 'en'

    const maps = await supaFetch(`/topical_maps?id=eq.${id}&select=id,name,stats`)
    const map = Array.isArray(maps) ? maps[0] : null
    if (!map) return NextResponse.json({ error: 'Map not found' }, { status: 404 })

    const topics = await supaFetch(
      `/topics?map_id=eq.${id}&select=id,title,target_keyword,search_volume,keyword_difficulty,business_value,priority_score,publication_wave,keyword_data_source,metric_provenance,topic_type&order=sort_order.asc`
    )
    const list = Array.isArray(topics) ? topics : []

    const needsEnrich = list.filter((t) => {
      if (!t.target_keyword) return false
      const src = String(t.keyword_data_source || '')
      const volMissing = t.search_volume == null || t.search_volume === 0
      const kdMissing = t.keyword_difficulty == null || t.keyword_difficulty === 0
      return (
        src.includes('spreadsheet') ||
        src === 'unverified' ||
        (volMissing && kdMissing) ||
        (src.includes('spreadsheet') && (volMissing || kdMissing))
      )
    })

    if (!needsEnrich.length) {
      return NextResponse.json({
        map_id: id,
        updated: 0,
        skipped: list.length,
        message: 'No topics needed metric enrichment',
      })
    }

    const keywords = [
      ...new Set(
        needsEnrich
          .map((t) => String(t.target_keyword || '').toLowerCase().trim())
          .filter(Boolean)
      ),
    ].slice(0, 80)

    const [dfs, ahr] = await Promise.all([
      fetchKeywordOverview(keywords, { locationName, languageCode }),
      isAhrefsAvailable()
        ? fetchAhrefsKeywordOverview(keywords, { country })
        : Promise.resolve(new Map()),
    ])

    let updated = 0
    let unverified = 0
    const nowIso = new Date().toISOString()

    for (const t of needsEnrich) {
      const kw = String(t.target_keyword || '').toLowerCase().trim()
      const d = dfs.get(kw) || {}
      const a = ahr.get(kw) || {}
      const volume = d.search_volume ?? a.search_volume ?? null
      const kd = d.keyword_difficulty ?? a.keyword_difficulty ?? null
      const grounded = volume != null || kd != null

      if (!grounded) {
        unverified += 1
        continue
      }

      const source = [
        d.search_volume != null || d.keyword_difficulty != null ? 'dataforseo' : null,
        a.search_volume != null || a.keyword_difficulty != null ? 'ahrefs' : null,
      ]
        .filter(Boolean)
        .join('+')

      const searchVolume = volume ?? t.search_volume ?? 0
      const keywordDifficulty = kd ?? t.keyword_difficulty ?? 0
      const businessValue = t.business_value ?? 50
      const priority = computeTopicPriorityScore({
        search_volume: searchVolume,
        keyword_difficulty: keywordDifficulty,
        business_value: businessValue,
      })

      const patch = {
        search_volume: searchVolume,
        keyword_difficulty: keywordDifficulty,
        priority_score: priority,
        keyword_data_source: source,
        metric_provenance: keywordMetricProvenance(source),
        updated_at: nowIso,
      }
      if (d.main_intent || a.search_intent) {
        patch.search_intent = d.main_intent || a.search_intent
      }
      if (d.cpc != null || a.cpc != null) patch.cpc = d.cpc ?? a.cpc
      if (d.volume_trend_yearly != null) patch.volume_trend_yearly = d.volume_trend_yearly
      if (a.traffic_potential != null) patch.traffic_potential = a.traffic_potential
      if (a.parent_topic != null) patch.parent_topic = a.parent_topic

      // Default: keep Phase → publication_wave. Only reshuffle when explicitly requested.
      if (reshuffleWaves && t.topic_type === 'supporting') {
        // Simple volume-based wave: high volume → wave 1
        if (searchVolume >= 500) patch.publication_wave = 1
        else if (searchVolume >= 100) patch.publication_wave = 2
        else patch.publication_wave = 3
      }

      await supaFetch(`/topics?id=eq.${t.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      })
      updated += 1
    }

    const stats = {
      ...(map.stats || {}),
      last_enrich_at: nowIso,
      last_enrich_updated: updated,
      last_enrich_unverified: unverified,
    }
    await supaFetch(`/topical_maps?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stats, updated_at: nowIso }),
    })

    return NextResponse.json({
      map_id: id,
      updated,
      unverified,
      considered: needsEnrich.length,
      keywords_queried: keywords.length,
      reshuffle_waves: reshuffleWaves,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    console.error('[topical-map/enrich-metrics]', error)
    return NextResponse.json({ error: error.message || 'Enrich failed' }, { status: 500 })
  }
}
