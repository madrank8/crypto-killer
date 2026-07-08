import { supaFetch } from './supabase'

/**
 * Update-history engine (2026-07-08).
 *
 * Every meaningful change to a published review must be VISIBLE on the
 * article ("Update history" block on the live page) and must be the thing
 * that justifies a dateModified bump — never the other way round. Google's
 * QRG rewards visible update provenance; silently bumping dates without
 * visible change is the "fake freshness" pattern our own quality auditor
 * hard-fails.
 *
 * Storage: reviews.update_history jsonb — an append-only array (oldest
 * first, capped) of:
 *   { date: '2026-07-08', type, summary, actor }
 *
 * Types:
 *   published        — first publish
 *   regenerated      — full investigation rewritten (generate route)
 *   visuals_updated  — polish resolved new visuals / hero imagery
 *   edited           — manual editorial change via the admin editor
 *   stats_update     — nightly surveillance refresh with a MATERIAL delta
 *
 * Renderers (Replit + Vercel preview) show the newest N entries reversed.
 */

const MAX_ENTRIES = 30

/** Content fields whose change constitutes a visible editorial update. */
export const EDITORIAL_FIELDS = [
  'title',
  'headline',
  'meta_description',
  'summary',
  'verdict',
  'how_it_works',
  'full_article',
  'red_flags',
  'faq',
  'key_takeaways',
  'protection_steps',
  'not_for_you',
  'methodology',
  'disclaimer',
]

export function normalizeUpdateHistory(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e) => e && typeof e === 'object' && typeof e.summary === 'string' && e.summary.trim())
    .map((e) => ({
      date: typeof e.date === 'string' ? e.date.slice(0, 10) : '',
      type: typeof e.type === 'string' ? e.type : 'edited',
      summary: e.summary.trim().slice(0, 200),
      actor: typeof e.actor === 'string' ? e.actor : 'system',
    }))
    .filter((e) => e.date)
    .slice(-MAX_ENTRIES)
}

export function makeEntry(type, summary, actor = 'system') {
  return {
    date: new Date().toISOString().slice(0, 10),
    type,
    summary: String(summary || '').slice(0, 200),
    actor,
  }
}

/**
 * Append an entry to a review's update_history (read-modify-write; the
 * write also bumps updated_at because a history entry IS a visible change).
 * Collapses same-day duplicates of the same type so a double polish or a
 * flurry of editor saves produces one line, not five.
 *
 * Never throws — provenance logging must not break the pipeline.
 * Returns the new array (or null on failure).
 */
export async function appendUpdateHistory(reviewId, entry, { fetcher = supaFetch } = {}) {
  try {
    if (!reviewId || !entry?.summary) return null
    const rows = await fetcher(`/reviews?id=eq.${reviewId}&select=update_history`)
    if (!Array.isArray(rows) || rows.length === 0) return null
    const history = normalizeUpdateHistory(rows[0].update_history)

    const deduped = history.filter(
      (e) => !(e.date === entry.date && e.type === entry.type),
    )
    deduped.push(makeEntry(entry.type, entry.summary, entry.actor))
    const capped = deduped.slice(-MAX_ENTRIES)

    await fetcher(`/reviews?id=eq.${reviewId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        update_history: capped,
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: 'return=minimal' },
    })
    return capped
  } catch (err) {
    console.warn('[update-history] append failed (non-fatal):', err?.message)
    return null
  }
}

/**
 * Compare two stats snapshots ({ ad_creatives, countries_targeted,
 * celebrities_abused, weekly_velocity, velocity_trend }) and decide whether
 * the change is MATERIAL enough to warrant a visible update entry.
 *
 * Thresholds (deliberately conservative — the update log must stay
 * meaningful, not become a noise feed):
 *   - any change in countries targeted
 *   - ad creatives +10 or more
 *   - celebrities +3 or more
 *   - velocity_trend flips to/from 'surging'
 */
export function buildStatsDelta(prev, next) {
  const p = prev || {}
  const n = next || {}
  const parts = []

  const adDelta = (n.ad_creatives || 0) - (p.ad_creatives || 0)
  if (adDelta >= 10) parts.push(`+${adDelta} ad creatives captured`)

  const geoDelta = (n.countries_targeted || 0) - (p.countries_targeted || 0)
  if (geoDelta > 0) parts.push(`${geoDelta} new ${geoDelta === 1 ? 'country' : 'countries'} targeted`)

  const celebDelta = (n.celebrities_abused || 0) - (p.celebrities_abused || 0)
  if (celebDelta >= 3) parts.push(`+${celebDelta} impersonated figures identified`)

  if (
    p.velocity_trend !== n.velocity_trend &&
    (n.velocity_trend === 'surging' || p.velocity_trend === 'surging')
  ) {
    parts.push(`ad velocity now ${n.velocity_trend}`)
  }

  return {
    material: parts.length > 0,
    summary: parts.length > 0 ? `Surveillance update: ${parts.join(', ')}` : null,
  }
}
