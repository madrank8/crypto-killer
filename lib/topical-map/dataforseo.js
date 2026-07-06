/**
 * lib/topical-map/dataforseo.js — DataForSEO calls for the v2 pipeline.
 *
 * Extends lib/keyword-data.js (keyword_overview) with the endpoints the
 * staged generator needs:
 *   - keyword_suggestions  (seed → long-tail containing the seed phrase)
 *   - related_keywords     (seed → "searches related to" graph, depth 2)
 *   - serp organic live    (top-10 URLs + SERP features + PAA per keyword)
 *
 * Design rules (same as keyword-data.js): never throw from a public
 * function; missing creds → callers must check isKeywordDataAvailable()
 * from lib/keyword-data.js and hard-fail the STAGE (v2 has no fabrication
 * fallback — audit finding G7).
 */

const DFS_LOGIN = process.env.DATAFORSEO_LOGIN || ''
const DFS_PASSWORD = process.env.DATAFORSEO_PASSWORD || ''
const DFS_TIMEOUT_MS = 40000

function authHeader() {
  return 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64')
}

async function dfsPost(endpoint, payload) {
  const res = await fetch(`https://api.dataforseo.com/v3${endpoint}`, {
    method: 'POST',
    signal: AbortSignal.timeout(DFS_TIMEOUT_MS),
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([payload]),
  })
  if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status} on ${endpoint}`)
  const data = await res.json()
  const task = data?.tasks?.[0]
  if (task?.status_code && task.status_code >= 40000) {
    throw new Error(`DataForSEO task error ${task.status_code}: ${task.status_message}`)
  }
  return task?.result?.[0] || null
}

function normalizeKeywordItem(raw) {
  // keyword_suggestions items carry data at top level; related_keywords
  // nests under keyword_data.
  const kd = raw?.keyword_data || raw
  const kw = String(kd?.keyword || '').toLowerCase().trim()
  if (!kw) return null
  return {
    keyword: kw,
    search_volume: Number.isFinite(kd?.keyword_info?.search_volume)
      ? kd.keyword_info.search_volume
      : null,
    keyword_difficulty: Number.isFinite(kd?.keyword_properties?.keyword_difficulty)
      ? kd.keyword_properties.keyword_difficulty
      : null,
    cpc: Number.isFinite(kd?.keyword_info?.cpc) ? kd.keyword_info.cpc : null,
    search_intent: kd?.search_intent_info?.main_intent || null,
    volume_trend_yearly: Number.isFinite(kd?.keyword_info?.search_volume_trend?.yearly)
      ? kd.keyword_info.search_volume_trend.yearly
      : null,
  }
}

/**
 * Long-tail suggestions containing the seed phrase.
 * @returns {Promise<Array>} normalized keyword items (may be empty)
 */
async function fetchKeywordSuggestions(seed, { locationName = 'United States', languageCode = 'en', limit = 150 } = {}) {
  try {
    const result = await dfsPost('/dataforseo_labs/google/keyword_suggestions/live', {
      keyword: String(seed).toLowerCase().slice(0, 80),
      location_name: locationName,
      language_code: languageCode,
      limit,
      include_serp_info: false,
    })
    return (result?.items || []).map(normalizeKeywordItem).filter(Boolean)
  } catch (e) {
    console.warn(`[tm-dfs] keyword_suggestions("${seed}") failed: ${e?.message || e}`)
    return []
  }
}

/**
 * "Searches related to" graph expansion (depth 2).
 */
async function fetchRelatedKeywords(seed, { locationName = 'United States', languageCode = 'en', limit = 100 } = {}) {
  try {
    const result = await dfsPost('/dataforseo_labs/google/related_keywords/live', {
      keyword: String(seed).toLowerCase().slice(0, 80),
      location_name: locationName,
      language_code: languageCode,
      depth: 2,
      limit,
    })
    return (result?.items || []).map(normalizeKeywordItem).filter(Boolean)
  } catch (e) {
    console.warn(`[tm-dfs] related_keywords("${seed}") failed: ${e?.message || e}`)
    return []
  }
}

/**
 * Keywords a competitor domain ranks for (competitor-gap stage).
 */
async function fetchRankedKeywords(domain, { locationName = 'United States', languageCode = 'en', limit = 200 } = {}) {
  try {
    const result = await dfsPost('/dataforseo_labs/google/ranked_keywords/live', {
      target: String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      location_name: locationName,
      language_code: languageCode,
      limit,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    })
    return (result?.items || []).map(normalizeKeywordItem).filter(Boolean)
  } catch (e) {
    console.warn(`[tm-dfs] ranked_keywords("${domain}") failed: ${e?.message || e}`)
    return []
  }
}

/**
 * Live SERP for one keyword: top-10 organic URLs, SERP feature types, PAA.
 * @returns {Promise<{keyword, urls:string[], domains:string[], features:string[], paa:string[]}|null>}
 */
async function fetchSerp(keyword, { locationName = 'United States', languageCode = 'en' } = {}) {
  try {
    const result = await dfsPost('/serp/google/organic/live/advanced', {
      keyword: String(keyword).slice(0, 100),
      location_name: locationName,
      language_code: languageCode,
      depth: 10,
    })
    if (!result) return null
    const items = result.items || []
    const organic = items.filter((i) => i?.type === 'organic').slice(0, 10)
    const paaBlock = items.find((i) => i?.type === 'people_also_ask')
    const paa = (paaBlock?.items || [])
      .map((q) => q?.title || q?.question)
      .filter(Boolean)
      .slice(0, 8)
    return {
      keyword: String(keyword).toLowerCase().trim(),
      urls: organic.map((o) => o.url).filter(Boolean),
      domains: organic.map((o) => o.domain).filter(Boolean),
      features: Array.isArray(result.item_types) ? result.item_types : [],
      paa,
    }
  } catch (e) {
    console.warn(`[tm-dfs] serp("${keyword}") failed: ${e?.message || e}`)
    return null
  }
}

/**
 * Fetch SERPs for many keywords with bounded concurrency.
 * @returns {Promise<Map<string, object>>} keyed by lowercased keyword
 */
async function fetchSerpsBatch(keywords, opts = {}, concurrency = 6) {
  const out = new Map()
  const queue = [...new Set((keywords || []).filter(Boolean))]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const kw = queue.shift()
      if (!kw) break
      const serp = await fetchSerp(kw, opts)
      if (serp) out.set(serp.keyword, serp)
    }
  })
  await Promise.all(workers)
  return out
}

module.exports = {
  fetchKeywordSuggestions,
  fetchRelatedKeywords,
  fetchRankedKeywords,
  fetchSerp,
  fetchSerpsBatch,
}
