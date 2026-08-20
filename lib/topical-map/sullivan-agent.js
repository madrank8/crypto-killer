'use strict'

const { isWritableContentTopic } = require('./writable-topic')
const { proposeSullivanType } = require('./readiness/propose-sullivan-type')
const { CONTENT_TYPES } = require('../content-brief/sullivan')

const SULLIVAN_ACTION = 'sullivan_evidence'
const OPEN_STATUSES = new Set(['planned', 'in_progress'])
const ALLOWED_TYPES = new Set(CONTENT_TYPES)

function sullivanDisabled(env = process.env) {
  if (env.AGENT_SULLIVAN === '0') return true
  if (env.AGENT_RUNNER === '0') return true
  return false
}

function sullivanFingerprint(topicId) {
  return `${SULLIVAN_ACTION}:${topicId}`
}

function notesHasExecutionStory(notes) {
  return /\b(we (executed|ran|shipped|built|launched)|before\/after|our (sprint|campaign|test))\b/i.test(
    String(notes || '')
  )
}

function notesHasThesis(notes) {
  return /\b(contrarian|thesis:|everyone (says|thinks)|consensus)\b/i.test(String(notes || ''))
}

/**
 * Constrain an LLM (or any) type proposal. Never accepts forcing inputs.
 * case_study / contrarian_opinion require an existing story/thesis in notes.
 * @returns {string|null} Sullivan type or null for "none"/invalid
 */
function allowLlmType(type, notes) {
  const t = String(type || '').trim()
  if (!t || t === 'none') return null
  if (!ALLOWED_TYPES.has(t)) return null
  if (t === 'case_study' && !notesHasExecutionStory(notes)) return null
  if (t === 'contrarian_opinion' && !notesHasThesis(notes)) return null
  return t
}

function parseLlmClassify(parsed, notes) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return allowLlmType(parsed.content_type, notes)
}

/**
 * A content_type already saved on the brief is the author's classification.
 * Never run it through the LLM notes gate — humans may declare any of the five.
 */
function existingSullivanType(brief) {
  const t = String(brief?.content_type || '').trim()
  return ALLOWED_TYPES.has(t) ? t : null
}

function classifyPrompt(topic) {
  const t = topic && typeof topic === 'object' ? topic : {}
  return `Classify ONE topical-map topic for Sullivan SC-098. Return JSON only:
{"content_type":"firsthand_review"|"infrastructure"|"original_data_study"|"case_study"|"contrarian_opinion"|"none","reason":"cite which of title|url_path|content_format|notes justified this"}
Do NOT emit forcing inputs, anecdotes, Q-IDs, metrics, or any other keys.
case_study only if notes already describe an execution we ran.
contrarian_opinion only if notes already state a thesis against consensus.
If unsure, use "none".

title: ${JSON.stringify(t.title || '')}
url_path: ${JSON.stringify(t.url_path || '')}
content_format: ${JSON.stringify(t.content_format || '')}
notes: ${JSON.stringify(t.notes || '')}`
}

async function countChildTopics(topic, supaFetch) {
  if (!topic?.id || typeof supaFetch !== 'function') return 0
  try {
    const rows = await supaFetch(
      `/topics?parent_id=eq.${encodeURIComponent(topic.id)}&select=id,title`
    )
    return Array.isArray(rows) ? rows.filter((r) => r?.title).length : 0
  } catch {
    return 0
  }
}

async function countPublishedInternalLinks(topic, supaFetch) {
  const links = Array.isArray(topic?.internal_links_to) ? topic.internal_links_to : []
  if (links.length < 3 || typeof supaFetch !== 'function') return 0
  const leaves = links
    .map((u) => String(u || '').replace(/\/+$/, '').split('/').filter(Boolean).pop())
    .filter(Boolean)
  if (leaves.length < 3) return 0
  try {
    const content = await supaFetch('/content?status=eq.published&select=slug&limit=200')
    const reviews = await supaFetch('/reviews?status=eq.published&select=slug&limit=200')
    const published = new Set()
    for (const row of Array.isArray(content) ? content : []) {
      if (row?.slug) published.add(row.slug)
    }
    for (const row of Array.isArray(reviews) ? reviews : []) {
      if (row?.slug) published.add(row.slug)
    }
    return leaves.filter((leaf) => published.has(leaf)).length
  } catch {
    return 0
  }
}

/**
 * /scams/ type pages → infrastructure only with ≥3 children or ≥3 published links.
 */
async function classifyScamsInfrastructure(topic, supaFetch) {
  if (!/\/scams\//i.test(String(topic?.url_path || ''))) return null
  const children = await countChildTopics(topic, supaFetch)
  if (children >= 3) return 'infrastructure'
  const published = await countPublishedInternalLinks(topic, supaFetch)
  if (published >= 3) return 'infrastructure'
  return null
}

async function classifySullivanType(topic, { supaFetch, callModel, extractJSON } = {}) {
  const det = proposeSullivanType(topic)
  if (det) return { content_type: det, source: 'deterministic' }

  const scams = await classifyScamsInfrastructure(topic, supaFetch)
  if (scams) return { content_type: scams, source: 'scams_graph' }

  if (typeof callModel !== 'function' || typeof extractJSON !== 'function') {
    return { content_type: null, source: 'none' }
  }

  try {
    const result = await callModel('gemini-flash', 'Return JSON only. Never invent evidence.', classifyPrompt(topic), {
      jsonMode: true,
      maxTokens: 256,
      label: 'sullivan-classify',
    })
    const parsed = extractJSON(result.text)
    const type = parseLlmClassify(parsed, topic?.notes)
    return { content_type: type, source: type ? 'llm' : 'llm_none' }
  } catch {
    return { content_type: null, source: 'llm_error' }
  }
}

function scheduledDate(topic) {
  const d = topic?.scheduled_for ? String(topic.scheduled_for).slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/**
 * Writable unpublished topics with a calendar date, not yet sullivan_ok.
 * @returns { ok: true, due: boolean } | false
 */
function eligibleForSullivan(topic, { briefsById, today } = {}) {
  if (!isWritableContentTopic(topic)) return false
  if (topic.content_id || topic.review_id) return false
  if (!OPEN_STATUSES.has(topic.content_status)) return false
  const due = scheduledDate(topic)
  if (!due) return false
  const brief = briefsById instanceof Map ? briefsById.get(topic.id) : briefsById?.[topic.id]
  if (brief?.sullivan_ok === true) return false
  return { ok: true, due: Boolean(today && due <= today) }
}

function pickNextSullivan(topics, opts = {}) {
  const due = []
  const upcoming = []
  for (const t of Array.isArray(topics) ? topics : []) {
    const verdict = eligibleForSullivan(t, opts)
    if (!verdict || verdict.ok !== true) continue
    if (verdict.due) due.push(t)
    else upcoming.push(t)
  }
  const sortFn = (a, b) => {
    const d = String(a.scheduled_for || '').localeCompare(String(b.scheduled_for || ''))
    if (d !== 0) return d
    return (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0)
  }
  due.sort(sortFn)
  upcoming.sort(sortFn)
  return { next: due[0] || upcoming[0] || null, due, upcoming }
}

module.exports = {
  SULLIVAN_ACTION,
  sullivanDisabled,
  sullivanFingerprint,
  notesHasExecutionStory,
  notesHasThesis,
  allowLlmType,
  parseLlmClassify,
  existingSullivanType,
  classifyPrompt,
  classifySullivanType,
  eligibleForSullivan,
  pickNextSullivan,
}
