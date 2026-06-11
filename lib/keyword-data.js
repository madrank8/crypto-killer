/**
 * lib/keyword-data.js — real keyword metrics via DataForSEO Labs
 * Date: 2026-06-11
 *
 * Closes P1-4 from the content-writing feature audit: topical-map
 * search_volume / keyword_difficulty were LLM-invented integers ("integer
 * 0-20000" straight from the generator prompt), and priority_score — the
 * content production queue order — was computed from fiction.
 *
 * Endpoint: POST /v3/dataforseo_labs/google/keyword_overview/live
 *   - up to 700 keywords per call
 *   - returns search_volume, keyword_difficulty, CPC, competition,
 *     monthly_searches, search intent in ONE call (cheaper than separate
 *     volume + bulk-difficulty calls at our scale)
 *
 * Response realities (probed live 2026-06-11):
 *   - Some keywords come back with NO keyword_info.search_volume and NO
 *     keyword_properties.keyword_difficulty (e.g. "pig butchering scam" —
 *     scam-adjacent terms get partial data). NEVER treat a missing field
 *     as 0 — merge only what the API actually returned and leave the
 *     existing value alone otherwise.
 *   - Keywords are lowercased by the API; match case-insensitively.
 *
 * Design rules (same as source-verify.js): never throw from a public
 * function — keyword grounding is an enhancement, not a point of failure.
 * No credentials → isKeywordDataAvailable() is false and callers skip.
 *
 * Env (free trial or paid acct from app.dataforseo.com):
 *   DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
 */

const DFS_LOGIN = process.env.DATAFORSEO_LOGIN || ''
const DFS_PASSWORD = process.env.DATAFORSEO_PASSWORD || ''
const DFS_TIMEOUT_MS = 30000
const MAX_KEYWORDS_PER_CALL = 700

function isKeywordDataAvailable() {
  return !!(DFS_LOGIN && DFS_PASSWORD)
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64')
}

/**
 * Fetch real metrics for a list of keywords.
 *
 * @param {string[]} keywords
 * @param {object} [opts] - { locationName = 'United States', languageCode = 'en' }
 * @returns {Promise<Map<string, {search_volume:number|null, keyword_difficulty:number|null,
 *   cpc:number|null, competition:number|null, main_intent:string|null,
 *   volume_trend_yearly:number|null}>>}
 *   Keyed by LOWERCASED keyword. Empty Map when unavailable or on failure.
 */
async function fetchKeywordOverview(keywords, opts = {}) {
  const out = new Map()
  if (!isKeywordDataAvailable()) return out

  const cleaned = [...new Set(
    (keywords || [])
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.trim().toLowerCase().slice(0, 80))
  )]
  if (cleaned.length === 0) return out

  const { locationName = 'United States', languageCode = 'en' } = opts

  for (let i = 0; i < cleaned.length; i += MAX_KEYWORDS_PER_CALL) {
    const chunk = cleaned.slice(i, i + MAX_KEYWORDS_PER_CALL)
    try {
      const res = await fetch(
        'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live',
        {
          method: 'POST',
          signal: AbortSignal.timeout(DFS_TIMEOUT_MS),
          headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            {
              keywords: chunk,
              location_name: locationName,
              language_code: languageCode,
            },
          ]),
        }
      )
      if (!res.ok) {
        console.warn(`[keyword-data] DataForSEO HTTP ${res.status} — chunk skipped`)
        continue
      }
      const data = await res.json()
      const items = data?.tasks?.[0]?.result?.[0]?.items || []
      for (const item of items) {
        const kw = String(item?.keyword || '').toLowerCase()
        if (!kw) continue
        out.set(kw, {
          search_volume: Number.isFinite(item?.keyword_info?.search_volume)
            ? item.keyword_info.search_volume
            : null,
          keyword_difficulty: Number.isFinite(item?.keyword_properties?.keyword_difficulty)
            ? item.keyword_properties.keyword_difficulty
            : null,
          cpc: Number.isFinite(item?.keyword_info?.cpc) ? item.keyword_info.cpc : null,
          competition: Number.isFinite(item?.keyword_info?.competition)
            ? item.keyword_info.competition
            : null,
          main_intent: item?.search_intent_info?.main_intent || null,
          volume_trend_yearly: Number.isFinite(item?.keyword_info?.search_volume_trend?.yearly)
            ? item.keyword_info.search_volume_trend.yearly
            : null,
        })
      }
    } catch (e) {
      console.warn(`[keyword-data] DataForSEO call failed (non-fatal): ${e?.message || e}`)
    }
  }
  return out
}

/**
 * Enrich an LLM-generated topical map (pillars → clusters → supporting)
 * with real metrics, in place. Only overwrites a node's search_volume /
 * keyword_difficulty when the API returned a real number for its
 * target_keyword; LLM estimates survive otherwise and the node is tagged
 * keyword_data_source: 'llm-estimated' vs 'dataforseo'.
 *
 * @param {object} mapData - { pillars: [...] } from topicalMapGeneratorPrompt
 * @param {object} [opts] - passed to fetchKeywordOverview
 * @returns {Promise<{requested:number, matched:number, grounded:number}>}
 */
async function enrichTopicalMapKeywords(mapData, opts = {}) {
  const nodes = []
  for (const pillar of mapData?.pillars || []) {
    nodes.push(pillar)
    for (const cluster of pillar?.clusters || []) {
      nodes.push(cluster)
      for (const node of cluster?.supporting || []) nodes.push(node)
    }
  }
  const keywords = nodes.map((n) => n?.target_keyword).filter(Boolean)
  const metrics = await fetchKeywordOverview(keywords, opts)

  let matched = 0
  let grounded = 0
  for (const node of nodes) {
    const kw = String(node?.target_keyword || '').trim().toLowerCase()
    const m = kw ? metrics.get(kw) : null
    if (!m) {
      node.keyword_data_source = 'llm-estimated'
      continue
    }
    matched++
    let usedReal = false
    if (m.search_volume !== null) {
      node.search_volume = m.search_volume
      usedReal = true
    }
    if (m.keyword_difficulty !== null) {
      node.keyword_difficulty = m.keyword_difficulty
      usedReal = true
    }
    if (m.main_intent) node.search_intent = m.main_intent
    if (m.volume_trend_yearly !== null) node.volume_trend_yearly = m.volume_trend_yearly
    node.keyword_data_source = usedReal ? 'dataforseo' : 'llm-estimated'
    if (usedReal) grounded++
  }
  return { requested: keywords.length, matched, grounded }
}

module.exports = {
  isKeywordDataAvailable,
  fetchKeywordOverview,
  enrichTopicalMapKeywords,
}
