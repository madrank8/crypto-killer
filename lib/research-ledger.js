/**
 * Cached verified research ledgers for content/review generation.
 *
 * Outline + generate used to re-run Gemini grounding + URL verification on
 * every SSE pass. This module stores a verified sources[] under
 * (subject_type, subject_key) with a TTL so subsequent passes reuse it.
 */

import { supaFetch } from '@/lib/supabase'

/** Default TTL: 7 days. Fresh enough for YMYL, long enough to skip re-research. */
export const RESEARCH_LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function isLedgerFresh(ledger, now = new Date()) {
  if (!ledger?.expires_at) return false
  const exp = Date.parse(ledger.expires_at)
  if (!Number.isFinite(exp)) return false
  return exp > now.getTime()
}

export function hasUsableSources(ledger) {
  return Array.isArray(ledger?.sources) && ledger.sources.length > 0
}

/**
 * Load a fresh ledger if one exists.
 * @returns {Promise<object|null>}
 */
export async function getResearchLedger(subjectType, subjectKey) {
  if (!subjectType || !subjectKey) return null
  try {
    const rows = await supaFetch(
      `/research_ledgers?subject_type=eq.${encodeURIComponent(subjectType)}` +
        `&subject_key=eq.${encodeURIComponent(subjectKey)}` +
        `&select=*&limit=1`,
      { useServiceRole: true },
    )
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return null
    if (!isLedgerFresh(row) || !hasUsableSources(row)) return null
    return row
  } catch (e) {
    console.warn('[research-ledger] get failed (non-fatal):', e.message)
    return null
  }
}

/**
 * Upsert a verified sources ledger.
 */
export async function saveResearchLedger({
  subjectType,
  subjectKey,
  sources,
  citations = null,
  meta = {},
  ttlMs = RESEARCH_LEDGER_TTL_MS,
  verifiedAt = new Date(),
}) {
  if (!subjectType || !subjectKey) {
    throw new Error('saveResearchLedger requires subjectType + subjectKey')
  }
  const nowIso = verifiedAt.toISOString()
  const expiresAt = new Date(verifiedAt.getTime() + ttlMs).toISOString()
  const body = {
    subject_type: subjectType,
    subject_key: subjectKey,
    sources: Array.isArray(sources) ? sources : [],
    citations,
    meta: meta && typeof meta === 'object' ? meta : {},
    verified_at: nowIso,
    expires_at: expiresAt,
    updated_at: nowIso,
  }

  try {
    // Prefer upsert via on_conflict
    const rows = await supaFetch(
      `/research_ledgers?on_conflict=subject_type,subject_key`,
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({ ...body, created_at: nowIso }),
      },
    )
    return Array.isArray(rows) ? rows[0] : rows
  } catch (e) {
    // Fallback: try update then insert
    console.warn('[research-ledger] upsert failed, trying patch/insert:', e.message)
    try {
      const updated = await supaFetch(
        `/research_ledgers?subject_type=eq.${encodeURIComponent(subjectType)}` +
          `&subject_key=eq.${encodeURIComponent(subjectKey)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(body),
        },
      )
      if (Array.isArray(updated) && updated[0]) return updated[0]
    } catch { /* fall through */ }

    const inserted = await supaFetch('/research_ledgers', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...body, created_at: nowIso }),
    })
    return Array.isArray(inserted) ? inserted[0] : inserted
  }
}

/**
 * Resolve sources for a subject: return cached if fresh, else null
 * (caller runs research + saveResearchLedger).
 */
export async function resolveResearchLedger(subjectType, subjectKey) {
  const cached = await getResearchLedger(subjectType, subjectKey)
  if (cached) {
    return {
      sources: cached.sources,
      citations: cached.citations,
      cached: true,
      ledger_id: cached.id,
      verified_at: cached.verified_at,
      expires_at: cached.expires_at,
    }
  }
  return null
}
