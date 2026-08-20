'use strict'

/**
 * Topics the admin "Write" action may open a content draft for.
 *
 * Koray import expands the sheet into a tree with structural pillars and
 * cluster folders that are not keyword pages. Writing those produces empty /
 * nonsensical drafts.
 */

function flagTypes(qaFlags) {
  if (!Array.isArray(qaFlags)) return []
  return qaFlags.map((f) => (typeof f === 'string' ? f : f?.type)).filter(Boolean)
}

function hasQaFlag(topic, type) {
  return flagTypes(topic?.qa_flags).includes(type)
}

/**
 * @param {object|null|undefined} topic
 * @returns {boolean}
 */
function isWritableContentTopic(topic) {
  if (!topic || typeof topic !== 'object') return false

  const type = topic.topic_type
  if (type === 'cluster') return false
  if (type === 'brand_review') return false
  if (hasQaFlag(topic, 'synthetic_hub')) return false

  if (type === 'supporting') {
    // Rolling / cadence placeholders are notes, not articles
    if (topic.rolling_placeholder === true) return false
    if (/\brolling\b/i.test(String(topic.notes || ''))) return false
    return true
  }

  if (type === 'pillar') {
    // Real sheet hubs use Title Tag Style ("Hub: Subtitle"). Synthetic Koray
    // pillars use short folder titles without a colon and often have no KW.
    const title = String(topic.title || '')
    const kw = String(topic.target_keyword || '').trim()
    if (!kw) return false
    if (!title.includes(':')) return false
    return true
  }

  return false
}

module.exports = {
  flagTypes,
  hasQaFlag,
  isWritableContentTopic,
}
