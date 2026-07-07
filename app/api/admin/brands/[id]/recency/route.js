import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { summarizePool } from '@/lib/recency-evidence'

/**
 * Recency evidence ingestion + read for a single brand.
 *
 * Populated by the agent pre-pass (Cowork): last30days → storm-research →
 * normalized grounded pool → POST here. Read by /api/admin/reviews/generate
 * Phase 2.6 (via lib/recency-evidence.js) as the `community_report` class.
 *
 * See last30days-integration-plan.md §4 for the payload contract.
 */

const KNOWN_SOURCES = new Set([
  'reddit', 'x', 'twitter', 'youtube', 'tiktok', 'hackernews', 'polymarket', 'other',
])

/** Validate + normalize one incoming pool item. Returns null if unusable. */
function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const snippet = typeof raw.snippet === 'string' ? raw.snippet.trim() : ''
  if (!url || !/^https?:\/\//i.test(url)) return null
  if (!title && !snippet) return null
  const source = KNOWN_SOURCES.has(raw.source) ? raw.source : 'other'
  return {
    source,
    url,
    title: title || null,
    snippet: snippet || null,
    engagement: raw.engagement ?? null,
    date: typeof raw.date === 'string' ? raw.date.slice(0, 10) : null,
    stance: typeof raw.stance === 'string' ? raw.stance : null,
    verdict: typeof raw.verdict === 'string' ? raw.verdict : null,
    confidence: typeof raw.confidence === 'string' ? raw.confidence : null,
  }
}

/**
 * GET /api/admin/brands/[id]/recency
 * Returns the stored pool + summary (or null if none).
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = params
    const rows = await supabaseRequest(
      `/brand_recency_evidence?brand_id=eq.${id}&select=*&limit=1`,
      { useServiceRole: true }
    )
    const row = Array.isArray(rows) ? rows[0] : null
    return Response.json({ brand_id: id, evidence: row || null })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/brands/[id]/recency
 * Upsert the recency evidence pool for a brand.
 *
 * Body: {
 *   pool: EvidenceItem[],            // required, non-empty
 *   summary?: object,                // optional — derived if absent
 *   dossier_md?: string,
 *   window_start?: 'YYYY-MM-DD',
 *   window_end?: 'YYYY-MM-DD',
 *   grounded_by?: string,
 *   run_note?: string
 * }
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = params

    // Confirm the brand exists (FK would reject anyway, but a clear 404 is nicer).
    const brand = await supabaseRequest(
      `/scam_brands?id=eq.${id}&select=id&limit=1`,
      { useServiceRole: true }
    )
    if (!Array.isArray(brand) || brand.length === 0) {
      return Response.json({ error: 'Brand not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const rawPool = Array.isArray(body.pool) ? body.pool : []
    const pool = rawPool.map(cleanItem).filter(Boolean)

    if (pool.length === 0) {
      return Response.json(
        { error: 'pool must be a non-empty array of {url, title|snippet, ...} items' },
        { status: 400 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)
    const record = {
      brand_id: id,
      pool,
      summary: body.summary && typeof body.summary === 'object' ? body.summary : summarizePool(pool),
      dossier_md: typeof body.dossier_md === 'string' ? body.dossier_md : null,
      window_start: typeof body.window_start === 'string' ? body.window_start.slice(0, 10) : null,
      window_end: typeof body.window_end === 'string' ? body.window_end.slice(0, 10) : today,
      grounded_by: typeof body.grounded_by === 'string' ? body.grounded_by : 'last30days+storm-research',
      run_note: typeof body.run_note === 'string' ? body.run_note : null,
      updated_at: new Date().toISOString(),
    }

    // Upsert on the PK (brand_id).
    const saved = await supabaseRequest(
      `/brand_recency_evidence?on_conflict=brand_id`,
      {
        method: 'POST',
        useServiceRole: true,
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(record),
      }
    )

    const row = Array.isArray(saved) ? saved[0] : saved
    return Response.json({
      ok: true,
      brand_id: id,
      stored_items: pool.length,
      dropped: rawPool.length - pool.length,
      summary: record.summary,
      evidence: row || null,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
