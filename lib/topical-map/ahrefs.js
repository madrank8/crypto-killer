/**
 * lib/topical-map/ahrefs.js — Ahrefs API v3 provider for the v2 pipeline.
 *
 * Second data source alongside lib/topical-map/dataforseo.js. Field shapes
 * probed live against the Ahrefs API v3 OpenAPI docs on 2026-07-06
 * (keywords-explorer/overview, keywords-explorer/matching-terms,
 * serp-overview). Notable Ahrefs-unique signals:
 *   - parent_topic / traffic_potential (clustering assist + prioritization)
 *   - serp_features incl. "ai_overview" WITHOUT a live SERP call (AIO risk)
 *   - serp-overview returns DR/UR/traffic per position → cluster
 *     winnability (authority landscape), which DataForSEO SERP lacks
 *
 * Auth: Bearer AHREFS_API_KEY (api.ahrefs.com/v3). Costs API units
 * (volume/difficulty/TP = 10 units each per row) — caller caps batch sizes.
 *
 * Design rules (same as dataforseo.js): never throw from a public
 * function; no creds → isAhrefsAvailable() false and callers skip. Ahrefs
 * is an ENHANCEMENT layer — the pipeline still hard-requires DataForSEO.
 */

const AHREFS_API_KEY = process.env.AHREFS_API_KEY || ''
const AHREFS_TIMEOUT_MS = 40000
const OVERVIEW_CHUNK = 100

function isAhrefsAvailable() {
  return !!AHREFS_API_KEY
}

async function ahrefsGet(endpoint, params) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const res = await fetch(`https://api.ahrefs.com/v3${endpoint}?${qs.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(AHREFS_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${AHREFS_API_KEY}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ahrefs HTTP ${res.status} on ${endpoint}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

/** Map Ahrefs intents object → single main intent (DataForSEO-compatible). */
function mainIntent(intents) {
  if (!intents || typeof intents !== 'object') return null
  if (intents.transactional) return 'transactional'
  if (intents.commercial) return 'commercial'
  if (intents.navigational || intents.branded) return 'navigational'
  if (intents.informational) return 'informational'
  return null
}

function normalizeAhrefsKeyword(row) {
  const kw = String(row?.keyword || '').toLowerCase().trim()
  if (!kw) return null
  return {
    keyword: kw,
    search_volume: Number.isFinite(row?.volume) ? row.volume : null,
    keyword_difficulty: Number.isFinite(row?.difficulty) ? row.difficulty : null,
    // Ahrefs returns CPC in USD cents; normalize to dollars like DataForSEO.
    cpc: Number.isFinite(row?.cpc) ? row.cpc / 100 : null,
    search_intent: mainIntent(row?.intents),
    traffic_potential: Number.isFinite(row?.traffic_potential) ? row.traffic_potential : null,
    parent_topic: row?.parent_topic || null,
    serp_features: Array.isArray(row?.serp_features) ? row.serp_features : [],
  }
}

/**
 * Keyword metrics for a list of keywords (chunked, 100/call).
 * @returns {Promise<Map<string, object>>} keyed by lowercased keyword
 */
async function fetchAhrefsKeywordOverview(keywords, { country = 'us' } = {}) {
  const out = new Map()
  if (!isAhrefsAvailable()) return out
  const cleaned = [...new Set(
    (keywords || [])
      .filter((k) => typeof k === 'string' && k.trim() && !k.includes(','))
      .map((k) => k.trim().toLowerCase().slice(0, 80))
  )]
  for (let i = 0; i < cleaned.length; i += OVERVIEW_CHUNK) {
    const chunk = cleaned.slice(i, i + OVERVIEW_CHUNK)
    try {
      const data = await ahrefsGet('/keywords-explorer/overview', {
        country,
        keywords: chunk.join(','),
        select: 'keyword,volume,difficulty,cpc,intents,traffic_potential,parent_topic,serp_features',
      })
      for (const row of data?.keywords || []) {
        const item = normalizeAhrefsKeyword(row)
        if (item) out.set(item.keyword, item)
      }
    } catch (e) {
      console.warn(`[tm-ahrefs] keyword overview chunk failed (non-fatal): ${e?.message || e}`)
    }
  }
  return out
}

/**
 * Keyword ideas containing the seed terms (Ahrefs Matching terms report).
 * @param {object} opts - { country, limit, questions } — questions=true
 *   returns only question-phrased ideas (canon PAA-style expansion).
 * @returns {Promise<Array>} normalized keyword items (may be empty)
 */
async function fetchAhrefsMatchingTerms(seed, { country = 'us', limit = 100, questions = false } = {}) {
  if (!isAhrefsAvailable()) return []
  try {
    const data = await ahrefsGet('/keywords-explorer/matching-terms', {
      country,
      keywords: String(seed).toLowerCase().slice(0, 80),
      match_mode: 'terms',
      terms: questions ? 'questions' : 'all',
      limit,
      order_by: 'volume:desc',
      select: 'keyword,volume,difficulty,cpc,intents,traffic_potential,parent_topic,serp_features',
    })
    return (data?.keywords || []).map(normalizeAhrefsKeyword).filter(Boolean)
  } catch (e) {
    console.warn(`[tm-ahrefs] matching_terms("${seed}") failed: ${e?.message || e}`)
    return []
  }
}

/**
 * SERP overview for one keyword: organic top-10 with authority metrics.
 * @returns {Promise<{keyword, positions:Array, authority:object}|null>}
 *   authority = { dr_min, dr_median, dr_max, weakest_top5_dr, low_dr_count }
 */
async function fetchAhrefsSerpOverview(keyword, { country = 'us', top = 10 } = {}) {
  if (!isAhrefsAvailable()) return null
  try {
    const data = await ahrefsGet('/serp-overview', {
      country,
      keyword: String(keyword).toLowerCase().slice(0, 100),
      top_positions: top,
      select: 'position,url,title,domain_rating,url_rating,traffic,type',
    })
    const organic = (data?.positions || []).filter(
      (p) => Array.isArray(p?.type) && p.type.includes('organic') && p.url
    )
    if (organic.length === 0) return null
    const positions = organic.slice(0, top).map((p) => ({
      position: p.position,
      url: p.url,
      title: p.title || null,
      domain_rating: Number.isFinite(p.domain_rating) ? p.domain_rating : null,
      url_rating: Number.isFinite(p.url_rating) ? p.url_rating : null,
      traffic: Number.isFinite(p.traffic) ? p.traffic : null,
    }))
    const drs = positions.map((p) => p.domain_rating).filter((d) => d !== null).sort((a, b) => a - b)
    const authority = drs.length === 0 ? null : {
      dr_min: drs[0],
      dr_median: drs[Math.floor(drs.length / 2)],
      dr_max: drs[drs.length - 1],
      weakest_top5_dr: positions.slice(0, 5).map((p) => p.domain_rating).filter((d) => d !== null).sort((a, b) => a - b)[0] ?? null,
      low_dr_count: drs.filter((d) => d < 30).length,
    }
    return { keyword: String(keyword).toLowerCase().trim(), positions, authority }
  } catch (e) {
    console.warn(`[tm-ahrefs] serp_overview("${keyword}") failed: ${e?.message || e}`)
    return null
  }
}

/**
 * SERP authority for many keywords with bounded concurrency.
 * @returns {Promise<Map<string, object>>} keyed by lowercased keyword
 */
async function fetchAhrefsSerpBatch(keywords, opts = {}, concurrency = 5) {
  const out = new Map()
  if (!isAhrefsAvailable()) return out
  const queue = [...new Set((keywords || []).filter(Boolean))]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const kw = queue.shift()
      if (!kw) break
      const serp = await fetchAhrefsSerpOverview(kw, opts)
      if (serp) out.set(serp.keyword, serp)
    }
  })
  await Promise.all(workers)
  return out
}

module.exports = {
  isAhrefsAvailable,
  fetchAhrefsKeywordOverview,
  fetchAhrefsMatchingTerms,
  fetchAhrefsSerpOverview,
  fetchAhrefsSerpBatch,
}
