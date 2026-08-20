'use strict'

const {
  WRITE_ACTION,
  autodraftDisabled,
  writeContentFingerprint,
  utcIsoWeekKey,
  weeklyCapReached,
  countDoneInIsoWeek,
  pickNextDue,
  nextWriteStage,
  fillRequestBody,
  cadencePerWeekFromMap,
} = require('./map-writer')

const SSE_BUDGET_MS = 680000
const TOPIC_SELECT =
  'id,title,slug,url_path,topic_type,qa_flags,notes,target_keyword,content_status,content_id,review_id,scheduled_for,priority_score,publication_wave'

async function consumeSse(url, init, fetchImpl, budgetMs = SSE_BUDGET_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budgetMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!res.ok || !res.body) {
      const text = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
      return { done: false, error: `HTTP ${res.status}: ${String(text).slice(0, 200)}`, timedOut: false }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        try {
          const evt = JSON.parse(dataLine.slice(6))
          if (evt.step === 'done') return { done: true, error: null, timedOut: false, result: evt.result || null }
          if (evt.step === 'error' || evt.error === true) {
            return { done: false, error: String(evt.message || 'pipeline error').slice(0, 300), timedOut: false }
          }
        } catch { /* keep reading */ }
      }
    }
    return { done: false, error: null, timedOut: false }
  } catch (e) {
    if (e.name === 'AbortError') return { done: false, error: null, timedOut: true }
    return { done: false, error: String(e.message).slice(0, 300), timedOut: false }
  } finally {
    clearTimeout(timer)
  }
}

async function logAgentAction(db, { action_type, fingerprint, content_id = null, detail = {} }) {
  try {
    await db('/agent_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ action_type, fingerprint, content_id, detail }]),
    })
  } catch (e) {
    console.warn('[map-writer] audit log failed:', e.message)
  }
}

async function loadWriteItems(db) {
  const rows = await db(
    `/work_plan_items?action_type=eq.${WRITE_ACTION}&select=*&order=updated_at.desc&limit=200`,
    { useServiceRole: true }
  )
  return Array.isArray(rows) ? rows : []
}

async function upsertWriteItem(db, { topic, status, why, contentId, lastError, outcome, deepLink }) {
  const fingerprint = writeContentFingerprint(topic.id)
  const existingRows = await db(
    `/work_plan_items?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=*&limit=1`,
    { useServiceRole: true }
  )
  const existing = Array.isArray(existingRows) ? existingRows[0] : null
  const patch = {
    action_type: WRITE_ACTION,
    target: topic.slug || topic.id,
    title: String(topic.title || 'Untitled').slice(0, 300),
    why: why ? String(why).slice(0, 1000) : null,
    priority: 'P1',
    status,
    content_id: contentId || existing?.content_id || null,
    deep_link: deepLink || (contentId ? `/admin/content/${contentId}` : `/admin/topical-map`),
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
      action_type: WRITE_ACTION,
      target: patch.target,
      title: patch.title,
      why: patch.why,
      priority: 'P1',
      status: patch.status,
      content_id: patch.content_id,
      deep_link: patch.deep_link,
      last_error: patch.last_error,
      outcome_json: patch.outcome_json,
      updated_at: new Date().toISOString(),
    }]),
  })
  return { fingerprint, ...patch }
}

async function loadContent(db, contentId) {
  if (!contentId) return null
  const rows = await db(`/content?id=eq.${encodeURIComponent(contentId)}&select=id,full_article,sections,outline_sections,status,published_at,topic_id&limit=1`, {
    useServiceRole: true,
  })
  return Array.isArray(rows) ? rows[0] || null : null
}

async function forceDraft(db, contentId) {
  await db(`/content?id=eq.${encodeURIComponent(contentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'draft', published_at: null, updated_at: new Date().toISOString() }),
  })
}

async function advanceStage({ item, topic, db, fetchImpl, origin, authHeader, consume }) {
  const contentId = item.content_id || topic.content_id
  const content = await loadContent(db, contentId)
  const stage = nextWriteStage(content)
  const jsonHeaders = {
    'Content-Type': 'application/json',
    Authorization: authHeader,
  }

  if (stage === 'create') {
    const res = await fetchImpl(`${origin}/api/admin/content/create`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ topic_id: topic.id }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `create failed (${res.status})`)
    await upsertWriteItem(db, {
      topic: { ...topic, content_id: body.id },
      status: 'running',
      why: 'Autodraft: stub created, outline next',
      contentId: body.id,
      outcome: { stage: 'created', content_id: body.id },
    })
    return { action: 'created', content_id: body.id, fingerprint: writeContentFingerprint(topic.id) }
  }

  if (stage === 'outline') {
    const sse = await consume(`${origin}/api/admin/content/outline`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ content_id: content.id }),
    }, fetchImpl)
    if (!sse.done) throw new Error(sse.error || (sse.timedOut ? 'outline timed out' : 'outline incomplete'))
    await upsertWriteItem(db, {
      topic,
      status: 'running',
      why: 'Autodraft: outline saved, fill next',
      contentId: content.id,
      outcome: { stage: 'outlined', content_id: content.id },
    })
    return { action: 'outlined', content_id: content.id, fingerprint: writeContentFingerprint(topic.id) }
  }

  if (stage === 'fill') {
    const sse = await consume(`${origin}/api/admin/content/fill`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(fillRequestBody(content.id)),
    }, fetchImpl)
    if (!sse.done) throw new Error(sse.error || (sse.timedOut ? 'fill timed out' : 'fill incomplete'))
    await forceDraft(db, content.id)
    await db(`/topics?id=eq.${encodeURIComponent(topic.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ content_status: 'draft', updated_at: new Date().toISOString() }),
    })
    const fingerprint = writeContentFingerprint(topic.id)
    await upsertWriteItem(db, {
      topic,
      status: 'done',
      why: 'Autodraft: draft filled — human publish required',
      contentId: content.id,
      outcome: { stage: 'filled', content_id: content.id, published: false },
    })
    await db(`/work_plan_items?fingerprint=eq.${encodeURIComponent(fingerprint)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ executed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    })
    return { action: 'filled', content_id: content.id, fingerprint, published: false }
  }

  const fingerprint = writeContentFingerprint(topic.id)
  await upsertWriteItem(db, {
    topic,
    status: 'done',
    why: 'Autodraft: draft already filled',
    contentId: content.id,
    outcome: { stage: 'filled', content_id: content.id, published: false },
  })
  await db(`/work_plan_items?fingerprint=eq.${encodeURIComponent(fingerprint)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ executed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  })
  return { action: 'already_filled', content_id: content.id, fingerprint, published: false }
}

async function loadMapContext(db, map) {
  const topics = await db(
    `/topics?map_id=eq.${map.id}&select=${TOPIC_SELECT}&order=sort_order.asc`,
    { useServiceRole: true }
  )
  const briefs = await db(
    `/content_briefs?map_id=eq.${map.id}&select=topic_id,sullivan_ok`,
    { useServiceRole: true }
  )
  const briefsById = new Map()
  for (const b of Array.isArray(briefs) ? briefs : []) {
    if (b?.topic_id) briefsById.set(b.topic_id, b)
  }
  return { topics: Array.isArray(topics) ? topics : [], briefsById }
}

async function topicById(db, id) {
  const rows = await db(`/topics?id=eq.${encodeURIComponent(id)}&select=${TOPIC_SELECT}&limit=1`, {
    useServiceRole: true,
  })
  return Array.isArray(rows) ? rows[0] || null : null
}

/**
 * Advance one autodraft stage. Never publishes.
 */
async function runMapWriterTick(opts = {}) {
  const env = opts.env || process.env
  const db = opts.supabaseRequest
  if (typeof db !== 'function') throw new Error('runMapWriterTick requires supabaseRequest')
  const fetchImpl = opts.fetchImpl || fetch
  const consume = opts.consumeSse || consumeSse
  const origin = opts.origin
  const authHeader = opts.authHeader
  const today = opts.today || new Date().toISOString().slice(0, 10)

  if (autodraftDisabled(env)) {
    return { skipped: true, reason: env.AGENT_AUTODRAFT === '0' ? 'AGENT_AUTODRAFT=0' : 'AGENT_RUNNER=0' }
  }
  if (!origin || !authHeader) throw new Error('runMapWriterTick requires origin and authHeader')

  const items = await loadWriteItems(db)
  const weekKey = utcIsoWeekKey(today)

  const running = items.find((i) => i.status === 'running')
  if (running) {
    const topicId = String(running.fingerprint || '').replace(/^write_content:/, '')
    const topic = await topicById(db, topicId)
    if (!topic) {
      await db(`/work_plan_items?fingerprint=eq.${encodeURIComponent(running.fingerprint)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'blocked', last_error: 'topic not found', updated_at: new Date().toISOString() }),
      })
      return { ok: false, action: 'blocked', error: 'topic not found' }
    }
    try {
      const result = await advanceStage({
        item: running,
        topic,
        db,
        fetchImpl,
        origin,
        authHeader,
        consume,
      })
      await logAgentAction(db, {
        action_type: 'write_content',
        fingerprint: running.fingerprint,
        content_id: result.content_id || null,
        detail: result,
      })
      return { ok: true, ...result }
    } catch (err) {
      await db(`/work_plan_items?fingerprint=eq.${encodeURIComponent(running.fingerprint)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'blocked', last_error: err.message, updated_at: new Date().toISOString() }),
      })
      await logAgentAction(db, {
        action_type: 'write_content_error',
        fingerprint: running.fingerprint,
        detail: { error: err.message },
      })
      return { ok: false, action: 'blocked', fingerprint: running.fingerprint, error: err.message }
    }
  }

  const maps = await db(
    '/topical_maps?status=eq.active&select=id,stats&order=updated_at.desc',
    { useServiceRole: true }
  )
  const activeMaps = Array.isArray(maps) ? maps : []

  for (const map of activeMaps) {
    const perWeek = cadencePerWeekFromMap(map)
    const doneThisWeek = countDoneInIsoWeek(items, weekKey)
    if (weeklyCapReached(doneThisWeek, perWeek)) {
      return { skipped: true, reason: 'weekly_cap', doneThisWeek, perWeek }
    }

    const { topics, briefsById } = await loadMapContext(db, map)
    const { next, blocked } = pickNextDue(topics, { briefsById, today })

    for (const b of blocked) {
      const fp = writeContentFingerprint(b.topic.id)
      const existing = items.find((i) => i.fingerprint === fp)
      if (existing && (existing.status === 'blocked' || existing.status === 'done' || existing.status === 'running')) {
        continue
      }
      await upsertWriteItem(db, {
        topic: b.topic,
        status: 'blocked',
        why: 'Needs Sullivan evidence before autodraft will write',
        lastError: 'needs_sullivan',
        outcome: { reason: 'needs_sullivan' },
        deepLink: `/admin/topical-map?map_id=${map.id}`,
      })
    }

    if (!next) continue

    const fingerprint = writeContentFingerprint(next.id)
    try {
      await upsertWriteItem(db, {
        topic: next,
        status: 'running',
        why: `Autodraft due ${next.scheduled_for}`,
        contentId: next.content_id,
        outcome: { stage: 'claimed' },
      })
      const result = await advanceStage({
        item: { fingerprint, content_id: next.content_id },
        topic: next,
        db,
        fetchImpl,
        origin,
        authHeader,
        consume,
      })
      await logAgentAction(db, {
        action_type: 'write_content',
        fingerprint,
        content_id: result.content_id || null,
        detail: result,
      })
      return { ok: true, map_id: map.id, ...result }
    } catch (err) {
      await upsertWriteItem(db, {
        topic: next,
        status: 'blocked',
        why: 'Autodraft failed',
        lastError: err.message,
      })
      await logAgentAction(db, {
        action_type: 'write_content_error',
        fingerprint,
        detail: { error: err.message },
      })
      return { ok: false, action: 'blocked', fingerprint, error: err.message }
    }
  }

  return { skipped: true, reason: 'nothing_due' }
}

module.exports = { runMapWriterTick, consumeSse }
