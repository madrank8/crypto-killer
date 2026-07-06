/**
 * lib/topical-map/clustering.js — SERP-overlap clustering + AIO risk.
 *
 * Canon (topical-map-creation v4.3, Phase 4): cluster keywords whose top-10
 * SERPs share >= SHARED_URL_THRESHOLD URLs — same result set means same
 * intent means ONE page. Keywords without SERP data are left unclustered
 * and placed semantically by the structuring LLM (labeled as such).
 *
 * AIO risk (references/aio-risk-score.md, Seer 2026 approximation):
 * exposure is a function of AI Overview presence on the live SERP and
 * intent (informational queries lose the most clicks to AIO; transactional
 * and brand/navigational retain clicks).
 */

const SHARED_URL_THRESHOLD = 3

/**
 * Union-find clustering by shared SERP URLs.
 * @param {Map<string, {urls:string[]}>} serpByKeyword
 * @returns {Map<string, string[]>} clusterKey → member keywords (clusterKey = representative kw)
 */
function clusterBySerpOverlap(serpByKeyword) {
  const keywords = [...serpByKeyword.keys()]
  const parent = new Map(keywords.map((k) => [k, k]))
  const find = (k) => {
    let root = k
    while (parent.get(root) !== root) root = parent.get(root)
    let cur = k
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  const urlSets = new Map(
    keywords.map((k) => [k, new Set(serpByKeyword.get(k).urls || [])])
  )

  for (let i = 0; i < keywords.length; i++) {
    for (let j = i + 1; j < keywords.length; j++) {
      const a = urlSets.get(keywords[i])
      const b = urlSets.get(keywords[j])
      if (a.size === 0 || b.size === 0) continue
      let shared = 0
      for (const u of a) {
        if (b.has(u)) {
          shared += 1
          if (shared >= SHARED_URL_THRESHOLD) break
        }
      }
      if (shared >= SHARED_URL_THRESHOLD) union(keywords[i], keywords[j])
    }
  }

  const clusters = new Map()
  for (const k of keywords) {
    const root = find(k)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(k)
  }
  return clusters
}

/**
 * AIO risk score for one keyword.
 * @param {{features?:string[]}} serp - SERP feature types for the keyword (or null)
 * @param {string|null} intent - DataForSEO main_intent
 * @returns {'low'|'medium'|'high'|'critical'}
 */
function scoreAioRisk(serp, intent) {
  const features = serp?.features || []
  const hasAio = features.includes('ai_overview')
  const hasSnippet = features.includes('featured_snippet')
  const informational = !intent || intent === 'informational'

  if (hasAio && informational) return 'critical'
  if (hasAio) return 'high'
  if (hasSnippet && informational) return 'high'
  if (informational) return 'medium'
  return 'low'
}

/**
 * Build cluster summaries for the structuring LLM.
 * @param {Map<string,string[]>} clusters
 * @param {Map<string,object>} poolByKeyword - metrics per keyword
 * @param {Map<string,object>} serpByKeyword
 */
function summarizeClusters(clusters, poolByKeyword, serpByKeyword) {
  const out = []
  for (const [key, members] of clusters.entries()) {
    const rows = members
      .map((kw) => poolByKeyword.get(kw))
      .filter(Boolean)
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
    if (rows.length === 0) continue
    const head = rows[0]
    const serp = serpByKeyword.get(key) || serpByKeyword.get(head.keyword) || null
    const totalVolume = rows.reduce((s, r) => s + (r.search_volume || 0), 0)
    out.push({
      cluster_key: key,
      head_keyword: head.keyword,
      keywords: rows.map((r) => ({
        keyword: r.keyword,
        search_volume: r.search_volume,
        keyword_difficulty: r.keyword_difficulty,
        search_intent: r.search_intent,
        covered_by: r.covered_by || null,
      })),
      covered_count: rows.filter((r) => r.covered_by).length,
      total_volume: totalVolume,
      dominant_intent: dominantIntent(rows),
      aio_risk: scoreAioRisk(serp, head.search_intent),
      serp_features: serp?.features || [],
      paa_questions: serp?.paa || [],
      top_domains: (serp?.domains || []).slice(0, 5),
    })
  }
  return out.sort((a, b) => b.total_volume - a.total_volume)
}

function dominantIntent(rows) {
  const counts = {}
  for (const r of rows) {
    const i = r.search_intent || 'informational'
    counts[i] = (counts[i] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'informational'
}

module.exports = {
  SHARED_URL_THRESHOLD,
  clusterBySerpOverlap,
  scoreAioRisk,
  summarizeClusters,
}
