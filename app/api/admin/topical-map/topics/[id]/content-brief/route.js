import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { validateSullivanGate, sullivanStopMessage } from '@/lib/content-brief/sullivan'
import { assembleBrief } from '@/lib/content-brief/assemble'
import { buildPublicationPlan } from '@/lib/topical-map/publication-plan'

/**
 * Full 12-section content brief for a topic (content-brief-generator v1.4).
 *
 *   GET  → { brief_row, gate }              current state + Sullivan Gate verdict
 *   PUT  → body { content_type, forcing_inputs }
 *          Validates the gate, persists the human-supplied inputs, and — only if
 *          the gate PASSES — assembles and stores the deterministic brief.
 *
 * The skill treats a failed gate as a HARD STOP. Here it is a *recoverable* block:
 * the response always carries the precise `missing` list and the field specs, so
 * the UI can show exactly what to supply. We never infer a forcing input.
 */

const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://cryptokiller.org'

async function loadTopic(id) {
  const rows = await supaFetch(`/topics?id=eq.${id}&select=*&limit=1`)
  return Array.isArray(rows) ? rows[0] : null
}

async function loadBriefRow(topicId) {
  const rows = await supaFetch(`/content_briefs?topic_id=eq.${topicId}&select=*&limit=1`)
  return Array.isArray(rows) ? rows[0] : null
}

// Gate verdict for a persisted row (or an empty gate when nothing is saved yet).
function gateFor(row) {
  return validateSullivanGate({
    content_type: row?.content_type || null,
    forcing_inputs: row?.forcing_inputs || null,
  })
}

export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const topic = await loadTopic(id)
    if (!topic) return Response.json({ error: 'Topic not found' }, { status: 404 })

    const row = await loadBriefRow(id)
    const gate = gateFor(row)
    return Response.json({ brief_row: row || null, gate, stop_message: sullivanStopMessage(gate) })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

// Lifecycle per the template's Section 1 `status` field. A brief may only leave
// 'draft' once the Sullivan Gate has passed and a brief actually exists —
// otherwise "approved" would mean nothing.
const STATUSES = ['draft', 'approved', 'in-production', 'published']

export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const status = body?.status
    if (!STATUSES.includes(status)) {
      return Response.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 })
    }

    const existing = await loadBriefRow(id)
    if (!existing) return Response.json({ error: 'No content brief for this topic yet.' }, { status: 404 })
    if (status !== 'draft' && !(existing.sullivan_ok && existing.brief)) {
      return Response.json(
        { error: 'Cannot advance past draft until the Sullivan Gate passes and a brief is generated.' },
        { status: 409 }
      )
    }

    await supaFetch(`/content_briefs?topic_id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    })
    const row = await loadBriefRow(id)
    return Response.json({ brief_row: row || null, gate: gateFor(row) })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const contentType = body?.content_type ?? null
    const forcingInputs = body?.forcing_inputs ?? null

    const topic = await loadTopic(id)
    if (!topic) return Response.json({ error: 'Topic not found' }, { status: 404 })

    // Validate BEFORE any assembly. A failed gate still persists what the author
    // typed so far — losing half-entered evidence would be its own dead end.
    const gate = validateSullivanGate({ content_type: contentType, forcing_inputs: forcingInputs })

    let brief = null
    if (gate.ok) {
      const parentTopic = topic.parent_id
        ? (await supaFetch(`/topics?id=eq.${topic.parent_id}&select=id,title,slug,url_path&limit=1`))?.[0] || null
        : null

      // Sibling topics give us both the slug→url_path index (for internal links /
      // dependencies, which are persisted as bare slugs) and the publication plan.
      const mapTopics = topic.map_id
        ? await supaFetch(`/topics?map_id=eq.${topic.map_id}&select=id,slug,url_path,publication_wave,priority_score,sort_order,content_status&order=sort_order.asc`)
        : []
      const siblings = Array.isArray(mapTopics) ? mapTopics : []

      const slugToPath = {}
      for (const t of siblings) if (t.slug && t.url_path) slugToPath[t.slug] = t.url_path

      // Locate this topic in the publication plan for Section 2.
      let publication = null
      const plan = buildPublicationPlan(siblings, { startDate: new Date().toISOString().slice(0, 10) })
      for (const week of plan.weeks) {
        const idx = week.topics.findIndex((t) => t.id === topic.id)
        if (idx !== -1) {
          publication = { week: week.week, target_date: week.target_date, order: idx + 1 }
          break
        }
      }

      brief = assembleBrief({
        topic,
        parentTopic,
        siteUrl: PUBLIC_SITE_URL,
        created: new Date().toISOString().slice(0, 10),
        sullivan: { content_type: gate.content_type, forcing_inputs: forcingInputs },
        publication,
        slugToPath,
      })
    }

    const existing = await loadBriefRow(id)
    const payload = {
      topic_id: id,
      map_id: topic.map_id || null,
      content_type: gate.content_type,
      forcing_inputs: forcingInputs && typeof forcingInputs === 'object' && !Array.isArray(forcingInputs) ? forcingInputs : null,
      sullivan_ok: gate.ok,
      updated_at: new Date().toISOString(),
    }
    // Only overwrite a stored brief when we actually assembled a new one — a
    // failed gate must not wipe a previously generated brief.
    if (brief) {
      payload.brief = brief
      payload.brief_id = brief.brief_id
      if (!existing?.status) payload.status = 'draft'
    }

    if (existing) {
      await supaFetch(`/content_briefs?topic_id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      })
    } else {
      await supaFetch('/content_briefs', {
        method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      })
    }

    const row = await loadBriefRow(id)
    return Response.json({ brief_row: row || null, gate, stop_message: sullivanStopMessage(gate) })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
