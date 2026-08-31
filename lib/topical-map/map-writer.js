'use strict'

const { isWritableContentTopic } = require('./writable-topic')
const { DEFAULT_CADENCE, CADENCES } = require('./publication-plan')

const WRITE_ACTION = 'write_content'

function autodraftDisabled(env = process.env) {
  if (env.AGENT_AUTODRAFT === '0') return true
  if (env.AGENT_RUNNER === '0') return true
  return false
}

function writeContentFingerprint(topicId) {
  return `${WRITE_ACTION}:${topicId}`
}

function utcIsoWeekKey(yyyyMmDd) {
  const d = new Date(`${String(yyyyMmDd || '').slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function weeklyCapReached(doneThisWeek, perWeek) {
  const cap = Number.isFinite(perWeek) && perWeek > 0 ? perWeek : CADENCES[DEFAULT_CADENCE].perWeek
  const n = Number.isFinite(doneThisWeek) ? doneThisWeek : 0
  return n >= cap
}

function countDoneInIsoWeek(items, weekKey) {
  if (!weekKey || !Array.isArray(items)) return 0
  let n = 0
  for (const item of items) {
    if (item?.action_type !== WRITE_ACTION) continue
    if (item.status !== 'done') continue
    const stamp = item.executed_at || item.updated_at
    if (!stamp) continue
    if (utcIsoWeekKey(String(stamp).slice(0, 10)) === weekKey) n += 1
  }
  return n
}

const OPEN_STATUSES = new Set(['planned', 'in_progress'])

/**
 * @returns { ok: true } | { ok: false, reason } | false (skip entirely)
 */
function eligibleForAutodraft(topic, { briefsById, today } = {}) {
  if (!isWritableContentTopic(topic)) return false
  if (topic.content_id || topic.review_id) return false
  if (!OPEN_STATUSES.has(topic.content_status)) return false
  const due = topic.scheduled_for ? String(topic.scheduled_for).slice(0, 10) : null
  if (!due || !today || due > today) return false
  const brief = briefsById instanceof Map ? briefsById.get(topic.id) : briefsById?.[topic.id]
  if (!brief || brief.sullivan_ok !== true) return { ok: false, reason: 'needs_sullivan' }
  return { ok: true }
}

function pickNextDue(topics, opts = {}) {
  const due = []
  const blocked = []
  for (const t of Array.isArray(topics) ? topics : []) {
    const verdict = eligibleForAutodraft(t, opts)
    if (verdict === false) continue
    if (verdict && verdict.ok === false) {
      blocked.push({ topic: t, reason: verdict.reason })
      continue
    }
    due.push(t)
  }
  due.sort((a, b) => {
    const d = String(a.scheduled_for || '').localeCompare(String(b.scheduled_for || ''))
    if (d !== 0) return d
    return (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0)
  })
  return { next: due[0] || null, blocked, due }
}

function nextWriteStage(content) {
  if (!content?.id) return 'create'
  const outline = Array.isArray(content.outline_sections) && content.outline_sections.length
    ? content.outline_sections
    : content.sections
  if (!Array.isArray(outline) || outline.length === 0) return 'outline'
  if (!content.full_article) return 'fill'
  return 'done'
}

function fillRequestBody(contentId) {
  return { content_id: contentId, auto_publish: false }
}

function cadencePerWeekFromMap(map) {
  const pub = map?.stats?.publication
  if (pub && Number.isFinite(pub.perWeek) && pub.perWeek > 0) return pub.perWeek
  const key = pub?.cadence
  if (key && CADENCES[key]) return CADENCES[key].perWeek
  return CADENCES[DEFAULT_CADENCE].perWeek
}

module.exports = {
  WRITE_ACTION,
  autodraftDisabled,
  writeContentFingerprint,
  utcIsoWeekKey,
  weeklyCapReached,
  countDoneInIsoWeek,
  eligibleForAutodraft,
  pickNextDue,
  nextWriteStage,
  fillRequestBody,
  cadencePerWeekFromMap,
}
