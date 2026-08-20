import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { persistScheduleOnTopics, publicationConfig } from '@/lib/topical-map/publication-schedule'
import { CADENCES, DEFAULT_CADENCE } from '@/lib/topical-map/publication-plan'

/**
 * PATCH /api/admin/topical-map/maps/[id]
 * Body: { cadence, start_date, perWeek } — persist publication plan dates onto topics.
 */
export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const cadence = CADENCES[body?.cadence] ? body.cadence : DEFAULT_CADENCE
    const startDate = body?.start_date || new Date().toISOString().slice(0, 10)
    const cfg = publicationConfig({ cadence, startDate, perWeek: body?.perWeek })

    const mapRows = await supaFetch(`/topical_maps?id=eq.${id}&select=id,stats&limit=1`)
    const map = Array.isArray(mapRows) ? mapRows[0] : null
    if (!map) return Response.json({ error: 'Map not found' }, { status: 404 })

    const topics = await supaFetch(
      `/topics?map_id=eq.${id}&select=id,title,target_keyword,topic_type,qa_flags,notes,content_status,content_id,review_id,publication_wave,priority_score,sort_order&order=sort_order.asc`
    )

    const schedule = await persistScheduleOnTopics(supaFetch, Array.isArray(topics) ? topics : [], {
      cadence: cfg.cadence,
      startDate: cfg.start_date,
      perWeek: cfg.perWeek,
    })

    const stats = { ...(map.stats && typeof map.stats === 'object' ? map.stats : {}) }
    stats.publication = {
      cadence: schedule.config.cadence,
      perWeek: schedule.config.perWeek,
      start_date: schedule.config.start_date,
      scheduled_count: schedule.scheduled_count,
    }

    await supaFetch(`/topical_maps?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stats, updated_at: new Date().toISOString() }),
    })

    return Response.json({ ok: true, publication: stats.publication })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
