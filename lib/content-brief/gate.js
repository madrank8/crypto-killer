'use strict'

const { supaFetch } = require('../supabase')

/**
 * Outline / fill must not run for SEO topics without a Sullivan-ok brief.
 * Discover mode is carved out (delayed-answer strategy fights the brief).
 *
 * @param {{ topicId?: string|null, contentType?: string|null }} opts
 * @returns {Promise<{ ok: true, brief: object|null, row: object|null, skipped?: string } | { ok: false, status: number, error: string, code: string, topic_id: string }>}
 */
async function requireSullivanBrief({ topicId, contentType } = {}) {
  if (!topicId) {
    return { ok: true, brief: null, row: null, skipped: 'no_topic' }
  }
  if (contentType === 'discover') {
    return { ok: true, brief: null, row: null, skipped: 'discover' }
  }

  let rows
  try {
    rows = await supaFetch(
      `/content_briefs?topic_id=eq.${encodeURIComponent(topicId)}&select=id,topic_id,sullivan_ok,content_type,brief,status&limit=1`,
    )
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: `Failed to load content brief: ${err.message}`,
      code: 'brief_lookup_failed',
      topic_id: topicId,
    }
  }

  const row = Array.isArray(rows) ? rows[0] : null
  if (!row?.sullivan_ok) {
    return {
      ok: false,
      status: 422,
      error:
        'Pass the Sullivan Gate on the topical map Content Brief panel before generating an outline or article. Open /admin/topical-map, find this topic, and use the clipboard icon (Content brief + Sullivan Gate). Map page format (pillar_page, guide, …) is NOT a Sullivan content_type.',
      code: 'sullivan_brief_required',
      topic_id: topicId,
    }
  }

  return {
    ok: true,
    brief: row.brief && typeof row.brief === 'object' ? row.brief : null,
    row,
  }
}

module.exports = { requireSullivanBrief }
