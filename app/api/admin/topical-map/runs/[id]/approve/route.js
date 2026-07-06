import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { fetchKeywordOverview } from '@/lib/keyword-data'
import { isAhrefsAvailable, fetchAhrefsKeywordOverview } from '@/lib/topical-map/ahrefs'
import { scoreAioRisk } from '@/lib/topical-map/clustering'

export const maxDuration = 120

/**
 * POST /api/admin/topical-map/runs/[id]/approve
 *
 * Clears a checkpoint (pool_review after serp_clustering, qa_review after
 * qa) so the dashboard can continue advancing. At pool_review the body may
 * carry edits:
 *
 *   {
 *     removed_cluster_keys?: string[],  // drop whole clusters
 *     removed_keywords?: string[],      // drop individual keywords
 *     promoted_keywords?: string[],     // unclustered → own mini-cluster
 *     added_keywords?: string[]         // user keywords — grounded with
 *   }                                   // real metrics here, never invented
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params

    const rows = await supaFetch(`/topical_map_runs?id=eq.${id}&select=*`)
    const run = Array.isArray(rows) ? rows[0] : null
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })
    if (run.status !== 'awaiting_approval') {
      return Response.json({ error: `Run is ${run.status}, not awaiting approval` }, { status: 409 })
    }

    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const artifacts = run.artifacts || {}
    const country = run.config?.country || 'us'
    const locationName = run.config?.locationName || 'United States'
    const languageCode = run.config?.languageCode || 'en'

    const norm = (k) => String(k || '').toLowerCase().trim().slice(0, 80)
    const removedClusters = new Set((body.removed_cluster_keys || []).map(norm).filter(Boolean))
    const removedKeywords = new Set((body.removed_keywords || []).map(norm).filter(Boolean))
    const promotedKeywords = [...new Set((body.promoted_keywords || []).map(norm).filter(Boolean))]
    const addedKeywords = [...new Set((body.added_keywords || []).map(norm).filter(Boolean))].slice(0, 50)

    const summary = { removed_clusters: 0, removed_keywords: 0, promoted: 0, added: 0, added_unverified: 0 }

    // ── Removals ──
    if (removedClusters.size > 0 && Array.isArray(artifacts.clusters)) {
      const before = artifacts.clusters.length
      artifacts.clusters = artifacts.clusters.filter((c) => !removedClusters.has(c.cluster_key))
      summary.removed_clusters = before - artifacts.clusters.length
    }
    if (removedKeywords.size > 0) {
      if (Array.isArray(artifacts.pool)) {
        const before = artifacts.pool.length
        artifacts.pool = artifacts.pool.filter((e) => !removedKeywords.has(e.keyword))
        summary.removed_keywords = before - artifacts.pool.length
      }
      if (Array.isArray(artifacts.unclustered)) {
        artifacts.unclustered = artifacts.unclustered.filter((kw) => !removedKeywords.has(kw))
      }
      if (Array.isArray(artifacts.clusters)) {
        for (const c of artifacts.clusters) {
          c.keywords = c.keywords.filter((k) => !removedKeywords.has(k.keyword))
          // If the head was removed, promote the highest-volume survivor.
          if (c.keywords.length > 0 && !c.keywords.some((k) => k.keyword === c.head_keyword)) {
            const newHead = [...c.keywords].sort(
              (a, b) => (b.search_volume || 0) - (a.search_volume || 0)
            )[0]
            c.head_keyword = newHead.keyword
          }
          c.total_volume = c.keywords.reduce((s, k) => s + (k.search_volume || 0), 0)
        }
        artifacts.clusters = artifacts.clusters.filter((c) => c.keywords.length > 0)
      }
    }

    // ── Additions: ground with real metrics (DataForSEO + Ahrefs) ──
    const poolByKeyword = new Map((artifacts.pool || []).map((e) => [e.keyword, e]))
    const newKeywords = addedKeywords.filter((kw) => !poolByKeyword.has(kw) && !removedKeywords.has(kw))
    if (newKeywords.length > 0) {
      const [dfs, ahr] = await Promise.all([
        fetchKeywordOverview(newKeywords, { locationName, languageCode }),
        isAhrefsAvailable() ? fetchAhrefsKeywordOverview(newKeywords, { country }) : Promise.resolve(new Map()),
      ])
      for (const kw of newKeywords) {
        const d = dfs.get(kw) || {}
        const a = ahr.get(kw) || {}
        const entry = {
          keyword: kw,
          method: 'user-added',
          search_volume: d.search_volume ?? a.search_volume ?? null,
          keyword_difficulty: d.keyword_difficulty ?? a.keyword_difficulty ?? null,
          cpc: d.cpc ?? a.cpc ?? null,
          search_intent: d.main_intent ?? a.search_intent ?? null,
          volume_trend_yearly: d.volume_trend_yearly ?? null,
          traffic_potential: a.traffic_potential ?? null,
          parent_topic: a.parent_topic ?? null,
          serp_features: a.serp_features || [],
        }
        const grounded =
          entry.search_volume != null || entry.keyword_difficulty != null
        entry.keyword_data_source = grounded
          ? [d.search_volume != null || d.keyword_difficulty != null ? 'dataforseo' : null,
             a.search_volume != null || a.keyword_difficulty != null ? 'ahrefs' : null]
              .filter(Boolean)
              .join('+')
          : 'unverified'
        if (!grounded) summary.added_unverified += 1
        artifacts.pool = artifacts.pool || []
        artifacts.pool.push(entry)
        poolByKeyword.set(kw, entry)
        summary.added += 1
      }
    }

    // ── Promotions + added keywords → clusters ──
    // Each becomes its own mini-cluster unless its Ahrefs parent_topic
    // matches an existing cluster member (then it joins that cluster).
    const clusterByMember = new Map()
    for (const c of artifacts.clusters || []) {
      for (const k of c.keywords) clusterByMember.set(k.keyword, c)
    }
    const toPlace = [
      ...promotedKeywords.filter((kw) => (artifacts.unclustered || []).includes(kw)),
      ...newKeywords,
    ]
    for (const kw of toPlace) {
      const e = poolByKeyword.get(kw)
      if (!e || clusterByMember.has(kw)) continue
      const pt = e.parent_topic ? norm(e.parent_topic) : null
      const target = pt ? clusterByMember.get(pt) : null
      const memberRow = {
        keyword: kw,
        search_volume: e.search_volume ?? null,
        keyword_difficulty: e.keyword_difficulty ?? null,
        search_intent: e.search_intent ?? null,
      }
      if (target) {
        target.keywords.push(memberRow)
        target.total_volume += e.search_volume || 0
        clusterByMember.set(kw, target)
      } else {
        const mini = {
          cluster_key: kw,
          head_keyword: kw,
          keywords: [memberRow],
          total_volume: e.search_volume || 0,
          dominant_intent: e.search_intent || 'informational',
          aio_risk: scoreAioRisk(
            e.serp_features?.length ? { features: e.serp_features } : null,
            e.search_intent
          ),
          serp_features: e.serp_features || [],
          paa_questions: [],
          top_domains: [],
        }
        artifacts.clusters = artifacts.clusters || []
        artifacts.clusters.push(mini)
        clusterByMember.set(kw, mini)
      }
      if ((artifacts.unclustered || []).includes(kw)) {
        artifacts.unclustered = artifacts.unclustered.filter((u) => u !== kw)
        summary.promoted += 1
      }
    }

    await supaFetch(`/topical_map_runs?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'running',
        artifacts,
        updated_at: new Date().toISOString(),
      }),
    })

    return Response.json({ ok: true, status: 'running', current_stage: run.current_stage, edits: summary })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
