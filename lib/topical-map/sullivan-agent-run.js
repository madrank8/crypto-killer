'use strict'

const {
  SULLIVAN_ACTION,
  sullivanDisabled,
  sullivanFingerprint,
  classifySullivanType,
  existingSullivanType,
  pickNextSullivan,
} = require('./sullivan-agent')
const { processTopic } = require('./readiness/run-map')
const { isWritableContentTopic } = require('./writable-topic')

const TOPIC_SELECT =
  'id,title,slug,url_path,topic_type,qa_flags,notes,target_keyword,content_status,content_id,review_id,scheduled_for,priority_score,publication_wave,content_type,content_format,internal_links_to'

async function logAgentAction(db, { action_type, fingerprint, content_id = null, detail = {} }) {
  try {
    await db('/agent_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ action_type, fingerprint, content_id, detail }]),
    })
  } catch (e) {
    console.warn('[map-sullivan] audit log failed:', e.message)
  }
}

async function upsertSullivanItem(db, { topic, status, why, lastError, outcome }) {
  const fingerprint = sullivanFingerprint(topic.id)
  const existingRows = await db(
    `/work_plan_items?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=*&limit=1`,
    { useServiceRole: true }
  )
  const existing = Array.isArray(existingRows) ? existingRows[0] : null
  const patch = {
    action_type: SULLIVAN_ACTION,
    target: topic.slug || topic.id,
    title: String(topic.title || 'Untitled').slice(0, 300),
    why: why ? String(why).slice(0, 1000) : null,
    priority: 'P1',
    status,
    deep_link: `/admin/topical-map`,
    last_error: lastError || null,
    outcome_json: outcome || existing?.outcome_json || null,
  }
  if (existing) {
    await db(`/work_plan_items?fingerprint=eq.${encodeURIComponent(fingerprint)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    })
    return { fingerprint, ...patch }
  }
  await db('/work_plan_items?on_conflict=fingerprint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      fingerprint,
      action_type: SULLIVAN_ACTION,
      target: patch.target,
      title: patch.title,
      why: patch.why,
      priority: 'P1',
      status: patch.status,
      deep_link: patch.deep_link,
      last_error: patch.last_error,
      outcome_json: patch.outcome_json,
      updated_at: new Date().toISOString(),
    }]),
  })
  return { fingerprint, ...patch }
}

async function loadMapContext(db, map) {
  const topics = await db(
    `/topics?map_id=eq.${map.id}&select=${TOPIC_SELECT}&order=sort_order.asc`,
    { useServiceRole: true }
  )
  const briefs = await db(
    `/content_briefs?map_id=eq.${map.id}&select=topic_id,sullivan_ok,content_type`,
    { useServiceRole: true }
  )
  const briefsById = new Map()
  for (const b of Array.isArray(briefs) ? briefs : []) {
    if (b?.topic_id) briefsById.set(b.topic_id, b)
  }
  return { topics: Array.isArray(topics) ? topics : [], briefsById }
}

/**
 * Classify + gather Sullivan evidence for one topic. Never publishes.
 * Never calls outline/fill.
 */
async function runMapSullivanTick(opts = {}) {
  const env = opts.env || process.env
  const db = opts.supabaseRequest
  if (typeof db !== 'function') throw new Error('runMapSullivanTick requires supabaseRequest')
  const today = opts.today || new Date().toISOString().slice(0, 10)
  const callModel = opts.callModel
  const extractJSON = opts.extractJSON
  const fetchImpl = opts.fetchImpl
  const firecrawlApiKey = opts.firecrawlApiKey

  if (sullivanDisabled(env)) {
    return { skipped: true, reason: env.AGENT_SULLIVAN === '0' ? 'AGENT_SULLIVAN=0' : 'AGENT_RUNNER=0' }
  }

  const maps = await db(
    '/topical_maps?status=eq.active&select=id,stats&order=updated_at.desc&limit=1',
    { useServiceRole: true }
  )
  const map = Array.isArray(maps) ? maps[0] : null
  if (!map) return { skipped: true, reason: 'no_active_map' }

  const { topics, briefsById } = await loadMapContext(db, map)
  const { next } = pickNextSullivan(topics, { briefsById, today })
  if (!next) return { skipped: true, reason: 'nothing_due' }
  if (!isWritableContentTopic(next)) return { skipped: true, reason: 'not_writable' }

  const humanType = existingSullivanType(briefsById.get(next.id))
  const classified = humanType
    ? { content_type: humanType, source: 'human' }
    : await classifySullivanType(next, { supaFetch: db, callModel, extractJSON })
  if (!classified.content_type) {
    await upsertSullivanItem(db, {
      topic: next,
      status: 'blocked',
      why: 'Needs Sullivan type before autodraft will write',
      lastError: 'unclassified',
      outcome: { reason: 'unclassified', source: classified.source },
    })
    await logAgentAction(db, {
      action_type: SULLIVAN_ACTION,
      fingerprint: sullivanFingerprint(next.id),
      detail: { topic_id: next.id, outcome: 'unclassified', source: classified.source },
    })
    return { action: 'unclassified', topic_id: next.id, fingerprint: sullivanFingerprint(next.id) }
  }

  const result = await processTopic({
    topic: next,
    mapId: map.id,
    supaFetch: db,
    fetchImpl,
    firecrawlApiKey,
    classifyType: classified.content_type,
  })

  const missing = Array.isArray(result.missing) ? result.missing.join(',') : ''
  if (result.outcome === 'sullivan_ok') {
    await upsertSullivanItem(db, {
      topic: next,
      status: 'done',
      why: `Sullivan ok (${result.content_type})`,
      lastError: null,
      outcome: { stage: 'sullivan_ok', content_type: result.content_type, source: classified.source },
    })
    await logAgentAction(db, {
      action_type: SULLIVAN_ACTION,
      fingerprint: sullivanFingerprint(next.id),
      detail: { topic_id: next.id, outcome: 'sullivan_ok', content_type: result.content_type },
    })
    return {
      action: 'sullivan_ok',
      topic_id: next.id,
      content_type: result.content_type,
      fingerprint: sullivanFingerprint(next.id),
    }
  }

  await upsertSullivanItem(db, {
    topic: next,
    status: 'blocked',
    why: 'Needs Sullivan evidence before autodraft will write',
    lastError: missing || result.outcome || 'needs_evidence',
    outcome: {
      reason: result.outcome || 'needs_evidence',
      content_type: result.content_type,
      missing: result.missing,
      source: classified.source,
    },
  })
  await logAgentAction(db, {
    action_type: SULLIVAN_ACTION,
    fingerprint: sullivanFingerprint(next.id),
    detail: { topic_id: next.id, outcome: result.outcome, missing: result.missing },
  })
  return {
    action: 'needs_evidence',
    topic_id: next.id,
    content_type: result.content_type,
    missing: result.missing,
    fingerprint: sullivanFingerprint(next.id),
  }
}

module.exports = { runMapSullivanTick }
