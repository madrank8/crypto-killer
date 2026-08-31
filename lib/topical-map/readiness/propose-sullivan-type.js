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
// wrong content_type would poison every forcing input gathered downstream.
// case_study and contrarian_opinion still require a human-declared story/thesis
// (or the constrained LLM fallback in sullivan-agent.js, which may still
// return "none").

const INFRA_SIGNAL_PATTERNS = [/glossary/i, /\bwiki\b/i, /\bdefinition\b/i, /\bfaq\s*hub\b/i, /\bfaq\b/i]
const DATA_STUDY_SIGNAL_PATTERNS = [/proprietary\s+dataset/i, /\bn\s*=\s*\d+/i, /\bsurvey\b/i]
const RESEARCH_PATH = /\/research\//i
const REVIEW_PATH = /\/review\//i
const ALERTS_PATH = /\/alerts\//i
const SAFETY_PATH = /\/safety\//i
const CHECK_PATH = /\/check\//i
const TOOLS_PATH = /\/tools\//i
const GUIDES_PATH = /\/guides\//i
const GUIDE_FIRSTHAND_TITLE = /recovery|report|scam.?check|checklist|scammed|what to do|ic3|first 24/i

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
  const path = String(t.url_path || '')

  // Brand reviews (existing pipeline) or any /review/ URL are unambiguously
  // firsthand accounts of using/investigating a product.
  if (t.content_type === 'brand_review' || REVIEW_PATH.test(path)) {
    return 'firsthand_review'
  }

  if (ALERTS_PATH.test(path) || SAFETY_PATH.test(path)) {
    return 'firsthand_review'
  }

  if (GUIDES_PATH.test(path) && GUIDE_FIRSTHAND_TITLE.test(String(t.title || ''))) {
    return 'firsthand_review'
  }

  // Glossary / definition / FAQ-hub / checker / tools TOF pages anchor the
  // entity graph rather than argue a thesis.
  if (
    matchesAny(t.title, INFRA_SIGNAL_PATTERNS) ||
    matchesAny(t.content_format, INFRA_SIGNAL_PATTERNS) ||
    CHECK_PATH.test(path) ||
    TOOLS_PATH.test(path)
  ) {
    return 'infrastructure'
  }

  // Explicit mention of a proprietary dataset, sample size, or survey in the
  // sheet's own notes/title is a real (if unverified-size) signal that this is
  // meant to be an original data study, not a guess about the data itself.
  if (matchesAny(t.notes, DATA_STUDY_SIGNAL_PATTERNS) || matchesAny(t.title, DATA_STUDY_SIGNAL_PATTERNS)) {
    return 'original_data_study'
  }

  if (RESEARCH_PATH.test(path) || matchesAny(t.content_format, [/case study/i])) {
    return 'original_data_study'
  }

  // /scams/ type explainers are NOT auto-classified here: infrastructure only
  // when ≥3 published internal URLs or ≥3 child topics exist (async check in
  // sullivan-agent). Do not force a data study on a single explainer.
  return null
}

module.exports = { proposeSullivanType }
