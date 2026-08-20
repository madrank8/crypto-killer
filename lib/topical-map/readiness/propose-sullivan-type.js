'use strict'

// Deterministic Sullivan content_type proposal (topical-map import robustness
// design spec section 7 / task 5). This function NEVER calls an LLM and NEVER
// guesses. It only proposes a type when a hard, mechanical signal already on
// the topic makes the classification obvious. Everything else returns null so
// the topic stays blocked (needs_evidence) instead of being force-fit into the
// wrong Sullivan path.
//
// Per honesty rule 6 (lib/content-brief/sullivan.js): forcing inputs come from
// the user, team, dataset, or portfolio, never from inference. Proposing the
// wrong content_type would poison every forcing input gathered downstream, so
// this table is intentionally narrow: brand reviews and TOF infrastructure
// pages have signals that are unambiguous from the map/sheet data alone;
// case_study and contrarian_opinion do not (they need a human-declared
// execution story or thesis), so this function never proposes them.

const INFRA_SIGNAL_PATTERNS = [/glossary/i, /\bwiki\b/i, /\bdefinition\b/i, /\bfaq\s*hub\b/i, /\bfaq\b/i]
const DATA_STUDY_SIGNAL_PATTERNS = [/proprietary\s+dataset/i, /\bn\s*=\s*\d+/i, /\bsurvey\b/i]
const RESEARCH_PATH = /\/research\//i

function matchesAny(str, patterns) {
  const s = String(str || '')
  return patterns.some((p) => p.test(s))
}

/**
 * @param topic { title?, url_path?, content_type?, content_format?, notes? }
 * @returns 'firsthand_review' | 'infrastructure' | 'original_data_study' | null
 */
function proposeSullivanType(topic) {
  const t = topic && typeof topic === 'object' ? topic : {}

  // Brand reviews (existing pipeline) or any /review/ URL are unambiguously
  // firsthand accounts of using/investigating a product.
  if (t.content_type === 'brand_review' || /\/review\//.test(String(t.url_path || ''))) {
    return 'firsthand_review'
  }

  // Glossary / definition / FAQ-hub TOF pages anchor the entity graph rather
  // than argue a thesis or report a result: Sullivan's infrastructure path.
  if (matchesAny(t.title, INFRA_SIGNAL_PATTERNS) || matchesAny(t.content_format, INFRA_SIGNAL_PATTERNS)) {
    return 'infrastructure'
  }

  // Explicit mention of a proprietary dataset, sample size, or survey in the
  // sheet's own notes/title is a real (if unverified-size) signal that this is
  // meant to be an original data study, not a guess about the data itself.
  if (matchesAny(t.notes, DATA_STUDY_SIGNAL_PATTERNS) || matchesAny(t.title, DATA_STUDY_SIGNAL_PATTERNS)) {
    return 'original_data_study'
  }

  if (RESEARCH_PATH.test(String(t.url_path || '')) || matchesAny(t.content_format, [/case study/i])) {
    return 'original_data_study'
  }

  // No deterministic signal. Prefer null over a wrong type: case_study and
  // contrarian_opinion in particular require a human-declared story/thesis
  // that no map field can honestly stand in for.
  return null
}

module.exports = { proposeSullivanType }
