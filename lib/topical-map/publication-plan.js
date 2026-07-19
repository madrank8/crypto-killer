'use strict'

// Step 22 — Publication Plan. Turns the map's already-assigned publication waves
// into a concrete weekly schedule at the site's cadence.
//
// Deterministic and honest: every input is a persisted topic field
// (publication_wave, priority_score, sort_order, content_status). `startDate` is
// an explicit argument — the module never reads a clock — so the same inputs
// always produce the same plan and the function stays unit-testable. When no
// startDate is supplied, weeks are still ordered but `target_date` is null
// rather than an invented date.

// Default cadences from the skill (Step 22). `perWeek` is the planning rate used
// for chunking; `rangeLabel` preserves the range the methodology states.
const CADENCES = Object.freeze({
  new: { key: 'new', label: 'New site', perWeek: 3, rangeLabel: '2–3 articles/week', refreshesPerWeek: 0, note: 'Quality Nodes first' },
  growing: { key: 'growing', label: 'Growing', perWeek: 5, rangeLabel: '3–5 articles/week', refreshesPerWeek: 0, note: null },
  established: { key: 'established', label: 'Established', perWeek: 2, rangeLabel: '1–2 articles/week + 1 refresh/week', refreshesPerWeek: 1, note: null },
  mature: { key: 'mature', label: 'Mature', perWeek: 1, rangeLabel: '1 article/week + 2 refreshes/week', refreshesPerWeek: 2, note: null },
})

const DEFAULT_CADENCE = 'growing'

function resolveCadence(cadence) {
  if (cadence && typeof cadence === 'object' && Number.isFinite(cadence.perWeek)) return cadence
  return CADENCES[cadence] || CADENCES[DEFAULT_CADENCE]
}

// Add whole days to a YYYY-MM-DD date in UTC. Returns null for unusable input so
// a bad startDate degrades to "no dates" instead of "Invalid Date".
function addDays(startDate, days) {
  if (!startDate) return null
  const base = startDate instanceof Date ? startDate : new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  const d = new Date(base.getTime() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

// Wave ordering: an unset wave sorts last rather than pretending to be wave 1.
const waveOf = (t) => (Number.isFinite(t?.publication_wave) ? t.publication_wave : Number.MAX_SAFE_INTEGER)
const priorityOf = (t) => (Number.isFinite(t?.priority_score) ? t.priority_score : 0)
const orderOf = (t) => (Number.isFinite(t?.sort_order) ? t.sort_order : 0)

/**
 * Build a weekly publication schedule.
 *
 * @param topics   array of topic rows
 * @param options  { cadence, startDate, perWeek, includePublished }
 * @returns { cadence, start_date, total, weeks: [{ week, target_date, topics }] }
 */
function buildPublicationPlan(topics, options = {}) {
  const { cadence, startDate = null, perWeek, includePublished = false } = options
  const resolved = resolveCadence(cadence)
  const rate = Number.isFinite(perWeek) && perWeek > 0 ? Math.floor(perWeek) : resolved.perWeek

  const list = Array.isArray(topics) ? topics.filter((t) => t && typeof t === 'object') : []
  // Already-published work is done — schedule what remains, don't re-plan history.
  const pending = includePublished ? list : list.filter((t) => t.content_status !== 'published')

  const ordered = [...pending].sort((a, b) => {
    const w = waveOf(a) - waveOf(b)
    if (w !== 0) return w
    const p = priorityOf(b) - priorityOf(a)
    if (p !== 0) return p
    return orderOf(a) - orderOf(b)
  })

  const weeks = []
  for (let i = 0; i < ordered.length; i += rate) {
    const week = weeks.length + 1
    weeks.push({
      week,
      target_date: addDays(startDate, (week - 1) * 7),
      topics: ordered.slice(i, i + rate),
    })
  }

  return {
    cadence: { ...resolved, perWeek: rate },
    start_date: startDate ? addDays(startDate, 0) : null,
    total: ordered.length,
    weeks,
  }
}

module.exports = { CADENCES, DEFAULT_CADENCE, buildPublicationPlan }
