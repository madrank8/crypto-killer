/**
 * lib/recency-evidence.js — read + map the last30days recency evidence pool.
 * Date: 2026-07-07
 *
 * The recency pool is produced OFF the serverless path: an agent pre-pass
 * (Cowork) runs `last30days` → `storm-research` on a brand, then upserts a
 * grounded, source-tokened pool into `brand_recency_evidence` via
 * POST /api/admin/brands/:id/recency.
 *
 * The review generate route reads it here in Phase 2.6 and merges the mapped
 * entries into the sourceLedger as a `community_report` class — behind the
 * RECENCY_EVIDENCE_ENABLED flag. These entries are PRE-GROUNDED by
 * storm-research, so they carry `verified:true` WITHOUT an HTTP liveness check
 * (the social domains are on source-verify's UNVERIFIABLE list by design).
 *
 * Design rules:
 *   - Never throw from a public function. Recency is an enrichment layer, not a
 *     point of failure — a missing/malformed pool must not kill a generation.
 *   - Regulator/news sources always rank first; community entries are capped and
 *     appended, never allowed to crowd out authoritative evidence.
 *   - A stale pool (window older than STALE_AFTER_DAYS) is flagged and, by
 *     default, still returned but down-weighted by the caller.
 */

import { supabaseRequest } from './supabase'

const STALE_AFTER_DAYS = 30
const DEFAULT_MAX_ENTRIES = 6

const KNOWN_SOURCES = new Set([
  'reddit', 'x', 'twitter', 'youtube', 'tiktok', 'hackernews', 'polymarket', 'other',
])

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000)
}

/**
 * Map one grounded pool item → a sourceLedger entry.
 * Returns null for items that are unusable (no url / no title).
 */
function mapItemToLedger(item) {
  if (!item || !item.url || !(item.title || item.snippet)) return null
  const source = KNOWN_SOURCES.has(item.source) ? item.source : 'other'
  const engagement =
    item.engagement && typeof item.engagement === 'object'
      ? (item.engagement.score ?? item.engagement.upvotes ?? null)
      : (typeof item.engagement === 'number' ? item.engagement : null)

  const dateLabel = item.date ? ` (${item.date})` : ''
  const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1)

  return {
    title: item.title || `${sourceLabel} — community report${dateLabel}`,
    url: item.url,
    type: 'community_report',
    class: 'community',
    // Pre-grounded by storm-research; NOT HTTP-checked (social domains are
    // intentionally unverifiable). The verdict/confidence carry the trust.
    verified: true,
    generic: false,
    extract: (item.snippet || item.title || '').slice(0, 400),
    recency: {
      date: item.date || null,
      engagement,
      source,
      stance: item.stance || null,
      verdict: item.verdict || null,
      confidence: item.confidence || null,
    },
  }
}

/**
 * Convert a raw pool array → capped, ranked ledger entries.
 * Ranking: Supported verdicts first, then higher engagement, then newer date.
 */
function mapRecencyToLedger(pool, { maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  if (!Array.isArray(pool)) return []
  const mapped = pool.map(mapItemToLedger).filter(Boolean)

  const verdictRank = (v) =>
    v === 'Supported' ? 0 : v === 'Partially supported' ? 1 : 2
  mapped.sort((a, b) => {
    const vr = verdictRank(a.recency.verdict) - verdictRank(b.recency.verdict)
    if (vr !== 0) return vr
    const er = (b.recency.engagement || 0) - (a.recency.engagement || 0)
    if (er !== 0) return er
    return String(b.recency.date || '').localeCompare(String(a.recency.date || ''))
  })

  return mapped.slice(0, maxEntries)
}

/**
 * Derive a compact summary from a pool (used by the ingestion endpoint when the
 * caller doesn't supply one, and by the admin UI freshness badge later).
 */
function summarizePool(pool) {
  if (!Array.isArray(pool) || pool.length === 0) {
    return { item_count: 0, platforms: [], newest_date: null, oldest_date: null, engagement_total: 0 }
  }
  const platforms = [...new Set(pool.map((p) => p?.source).filter(Boolean))]
  const dates = pool.map((p) => p?.date).filter(Boolean).sort()
  const engagement_total = pool.reduce((sum, p) => {
    const e = p?.engagement
    const n = e && typeof e === 'object' ? (e.score ?? e.upvotes ?? 0) : (typeof e === 'number' ? e : 0)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)
  return {
    item_count: pool.length,
    platforms,
    newest_date: dates[dates.length - 1] || null,
    oldest_date: dates[0] || null,
    engagement_total,
  }
}

/**
 * Read + map the recency evidence for a brand. Best-effort: returns a stable
 * empty result on any error or when the flag is off.
 *
 * @param {string} brandId
 * @param {{ enabled?: boolean, maxEntries?: number }} opts
 * @returns {Promise<{ entries: Array, stale: boolean, summary: object, windowEnd: string|null }>}
 */
async function fetchRecencyEvidence(brandId, opts = {}) {
  const empty = { entries: [], stale: false, summary: { item_count: 0 }, windowEnd: null }

  const enabled = opts.enabled ?? (process.env.RECENCY_EVIDENCE_ENABLED === '1')
  if (!enabled || !brandId) return empty

  try {
    const rows = await supabaseRequest(
      `/brand_recency_evidence?brand_id=eq.${brandId}` +
        `&select=pool,summary,window_end&limit=1`,
      { useServiceRole: true }
    )
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || !Array.isArray(row.pool) || row.pool.length === 0) return empty

    const windowEnd = row.window_end || null
    const stale = windowEnd
      ? daysBetween(new Date(), new Date(windowEnd)) > STALE_AFTER_DAYS
      : true

    // Stale pools still return, but with a tighter cap so they can't dominate.
    const maxEntries = stale ? Math.min(opts.maxEntries ?? DEFAULT_MAX_ENTRIES, 3)
                             : (opts.maxEntries ?? DEFAULT_MAX_ENTRIES)

    return {
      entries: mapRecencyToLedger(row.pool, { maxEntries }),
      stale,
      summary: row.summary && typeof row.summary === 'object' ? row.summary : summarizePool(row.pool),
      windowEnd,
    }
  } catch (err) {
    // Enrichment layer — never fatal.
    // eslint-disable-next-line no-console
    console.error('[recency-evidence] read failed (non-fatal):', err.message)
    return empty
  }
}

export { fetchRecencyEvidence, mapRecencyToLedger, summarizePool, STALE_AFTER_DAYS }
