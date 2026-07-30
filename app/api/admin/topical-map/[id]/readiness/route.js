import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export const maxDuration = 300

/**
 * GET/POST /api/admin/topical-map/[id]/readiness
 *
 * GET  -> current readiness summary (topical_maps.stats.readiness, set by the
 *         last run) plus a live content_briefs count for this map, so the UI
 *         can show status even before any run has happened.
 * POST -> runs lib/topical-map/readiness/run-map.js's startMapReadiness for
 *         every supporting topic on this map (propose type -> stack gather ->
 *         optional Firecrawl -> Sullivan gate -> content_briefs upsert) and
 *         returns the summary. Safe to re-run: it only fills gaps, it never
 *         overwrites a human-supplied forcing input or a human-declared
 *         content_type.
 */

async function loadMap(id) {
  const rows = await supaFetch(`/topical_maps?id=eq.${id}&select=id,name,stats&limit=1`)
  return Array.isArray(rows) ? rows[0] || null : null
}

async function loadBriefCounts(mapId) {
  const rows = await supaFetch(`/content_briefs?map_id=eq.${mapId}&select=id,content_type,sullivan_ok`)
  const list = Array.isArray(rows) ? rows : []
  return {
    total: list.length,
    sullivan_ok: list.filter((b) => b.sullivan_ok).length,
    needs_evidence: list.filter((b) => !b.sullivan_ok).length,
  }
}

export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const map = await loadMap(id)
    if (!map) return Response.json({ error: 'Map not found' }, { status: 404 })

    const briefCounts = await loadBriefCounts(id)

    return Response.json({
      map_id: id,
      readiness: map.stats?.readiness || null,
      brief_counts: briefCounts,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const map = await loadMap(id)
    if (!map) return Response.json({ error: 'Map not found' }, { status: 404 })

    const { startMapReadiness } = await import('@/lib/topical-map/readiness/run-map')
    const summary = await startMapReadiness({ mapId: id, supaFetch })

    const briefCounts = await loadBriefCounts(id)

    return Response.json({ map_id: id, ...summary, brief_counts: briefCounts })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    console.error('[topical-map/readiness]', error)
    return Response.json({ error: error.message || 'Readiness run failed' }, { status: 500 })
  }
}
