'use strict'

// Persist Step-22 weekly dates onto writable unpublished topics.
// buildPublicationPlan stays clock-free: callers pass an explicit startDate.

const { CADENCES, DEFAULT_CADENCE, buildPublicationPlan } = require('./publication-plan')
const { isWritableContentTopic } = require('./writable-topic')

function isSchedulableTopic(topic) {
  if (!isWritableContentTopic(topic)) return false
  if (topic.content_id || topic.review_id) return false
  if (topic.content_status === 'published') return false
  return true
}

function publicationConfig(options = {}) {
  const cadenceKey = CADENCES[options.cadence] ? options.cadence : DEFAULT_CADENCE
  const resolved = CADENCES[cadenceKey]
  const requested = Number.isFinite(options.perWeek) && options.perWeek > 0
    ? Math.floor(options.perWeek)
    : resolved.perWeek
  const perWeek = Number.isFinite(requested) && requested > 0 ? requested : CADENCES[DEFAULT_CADENCE].perWeek
  return {
    cadence: cadenceKey,
    perWeek,
    start_date: options.startDate || null,
  }
}

/**
 * @param topics array of topic rows
 * @param options { cadence, startDate, perWeek }
 * @returns { config, assignments: Map<id, YYYY-MM-DD|null>, plan }
 */
function assignScheduledFor(topics, options = {}) {
  const cfg = publicationConfig(options)
  const pending = (Array.isArray(topics) ? topics : []).filter(isSchedulableTopic)
  const plan = buildPublicationPlan(pending, {
    cadence: cfg.cadence,
    startDate: cfg.start_date,
    perWeek: cfg.perWeek,
  })
  const assignments = new Map()
  for (const week of plan.weeks) {
    for (const t of week.topics || []) {
      if (t?.id) assignments.set(t.id, week.target_date || null)
    }
  }
  return {
    config: { cadence: plan.cadence.key, perWeek: plan.cadence.perWeek, start_date: plan.start_date },
    assignments,
    plan,
  }
}

async function persistScheduleOnTopics(supaFetch, topics, options = {}) {
  if (typeof supaFetch !== 'function') throw new Error('persistScheduleOnTopics requires supaFetch')
  const { config, assignments } = assignScheduledFor(topics, options)
  let patched = 0
  for (const [id, date] of assignments) {
    await supaFetch(`/topics?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ scheduled_for: date }),
    })
    patched += 1
  }
  return { config, patched, scheduled_count: assignments.size }
}

module.exports = {
  isSchedulableTopic,
  publicationConfig,
  assignScheduledFor,
  persistScheduleOnTopics,
}
