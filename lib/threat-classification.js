'use strict'

/**
 * lib/threat-classification.js — THE central score→language map.
 * Phase 1 (SEO/GEO + editorial-quality upgrade), 2026-08-31.
 *
 * Before this file, `classifyThreat` lived in lib/threat-score.js and decided
 * editorial register from the number alone. Two problems with that:
 *
 *   1. `frameAsScam` was true from 60 up, so a 60-79 "high risk" brand could
 *      ship declarative "is a confirmed crypto scam" prose. The published
 *      methodology (cryptokiller.org/methodology) is stricter than that: the
 *      80+ band is defined as "confirmed scam with regulator-issued warnings,
 *      multiple jurisdictional enforcement actions, or documented consumer
 *      harm". The score is a necessary condition for that language, never a
 *      sufficient one.
 *
 *   2. There was no way for an analyst to say "the number says X, the file
 *      says Y" without editing the score itself — which corrupts the metric.
 *
 * So classification is now computed in two steps:
 *
 *   band(score)        → the score's own band. Pure arithmetic.
 *   classifyThreat()   → band + evidence + explicit override → the register
 *                        the copy is actually allowed to use.
 *
 * `frameAsScam` (definitive scam/fraud language permitted) is now true ONLY
 * when the band is CONFIRMED *and* the methodology's evidentiary test is
 * satisfied. An 80+ entity with no regulator warning, no enforcement action
 * and no documented consumer harm is presented as HIGH RISK prose while
 * keeping its real numeric score — `evidenceShortfall` records why.
 *
 * Tier KEYS ('confirmed'|'high'|'elevated'|'watchlist'|'low') are unchanged
 * on purpose: they ship to Replit as `threat_tier` and are persisted in
 * generated review JSON. The human-facing `label`/`badge`/`classification`
 * are the parts Phase 1 rewords.
 */

// ─── Bands ────────────────────────────────────────────────────────────────
// Ordered high→low; `min` is inclusive. Every band is reachable and the set
// covers 0-100 with no gap (asserted by test/threat-classification.test.js).
const BANDS = Object.freeze([
  {
    tier: 'confirmed',
    min: 80,
    max: 100,
    classification: 'CONFIRMED',
    label: 'Confirmed / Extreme Risk',
    badge: 'CONFIRMED',
    // Only reachable with evidence — see requiresCorroboration below.
    requiresCorroboration: true,
    frameAsScam: true,
    prose: 'is a confirmed crypto scam',
    verdictOpener: 'is a confirmed crypto scam. Do not deposit funds',
    languageRule:
      'Definitive scam/fraud language is permitted because the evidentiary test in the published methodology is satisfied.',
  },
  {
    tier: 'high',
    min: 60,
    max: 79,
    classification: 'HIGH_RISK',
    label: 'High Risk',
    badge: 'HIGH RISK',
    requiresCorroboration: false,
    frameAsScam: false,
    prose: 'shows strong evidence of fraudulent activity',
    verdictOpener:
      'shows strong evidence of fraudulent activity. Treat any deposit as money you will not get back',
    languageRule:
      'Strong warning language is permitted where the evidence on file supports the specific claim. Do not assert "confirmed scam" as settled fact.',
  },
  {
    tier: 'elevated',
    min: 40,
    max: 59,
    classification: 'ELEVATED_RISK',
    label: 'Elevated Risk',
    badge: 'ELEVATED RISK',
    requiresCorroboration: false,
    frameAsScam: false,
    prose: 'exhibits multiple substantiated warning signals associated with investment fraud',
    verdictOpener: 'exhibits multiple substantiated warning signals. Exercise extreme caution',
    languageRule:
      'Substantiated warning signals may be described clearly, but every sentence must keep observed facts separate from inference.',
  },
  {
    tier: 'watchlist',
    min: 20,
    max: 39,
    classification: 'UNDER_INVESTIGATION',
    label: 'Under Investigation',
    badge: 'UNDER INVESTIGATION',
    requiresCorroboration: false,
    frameAsScam: false,
    prose: 'is under active investigation by Crypto Killer',
    verdictOpener: 'is under active investigation. Verify independently before depositing',
    languageRule:
      'Observed warning signals may be described. Unverified fraud claims must not be stated as established fact.',
  },
  {
    tier: 'low',
    min: 0,
    max: 19,
    classification: 'LIMITED_EVIDENCE',
    label: 'Limited Evidence',
    badge: 'LIMITED EVIDENCE',
    requiresCorroboration: false,
    frameAsScam: false,
    prose: 'has not produced enough evidence to be classified as a confirmed scam',
    verdictOpener:
      'has not produced enough evidence for Crypto Killer to classify it as a confirmed scam. Monitoring continues',
    languageRule:
      'State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud.',
  },
])

const CLASSIFICATIONS = Object.freeze(BANDS.map((b) => b.classification))

/** Human-facing label for a classification key. */
const CLASSIFICATION_LABELS = Object.freeze(
  Object.fromEntries(BANDS.map((b) => [b.classification, b.label])),
)

// ─── Score normalisation ──────────────────────────────────────────────────

/**
 * A score is VALID only if it is a finite number in [0, 100]. Anything else
 * (null, NaN, '42', -3, 140) is invalid — callers get `valid: false` and a
 * clamped/zeroed score so rendering never crashes, while the validator can
 * still report the bad input rather than silently seeing a 0.
 */
function normalizeScore(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { score: 0, valid: false, reason: raw === null || raw === undefined ? 'missing' : 'not_a_finite_number' }
  }
  if (raw < 0 || raw > 100) {
    return { score: Math.max(0, Math.min(100, raw)), valid: false, reason: 'out_of_range' }
  }
  return { score: raw, valid: true, reason: null }
}

/** Band for a already-normalised 0-100 score. Pure arithmetic, no evidence. */
function bandForScore(score) {
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1]
}

// ─── The methodology's evidentiary test for CONFIRMED ─────────────────────
//
// Quoted from cryptokiller.org/methodology, 80+ band: "confirmed scam with
// regulator-issued warnings, multiple jurisdictional enforcement actions, or
// documented consumer harm". Any ONE of the three satisfies it.
const CORROBORATION_TESTS = Object.freeze([
  {
    key: 'regulator_warning',
    describe: 'a regulator-issued warning naming this entity',
    satisfied: (e) => countRegulatorWarnings(e) >= 1,
  },
  {
    key: 'multi_jurisdiction_enforcement',
    describe: 'enforcement actions in more than one jurisdiction',
    satisfied: (e) => distinctJurisdictions(e) >= 2,
  },
  {
    key: 'documented_consumer_harm',
    describe: 'documented consumer harm (victim reports on file)',
    satisfied: (e) => victimReportCount(e) >= 1,
  },
])

function asArray(v) {
  return Array.isArray(v) ? v : []
}

function countRegulatorWarnings(evidence) {
  return asArray(evidence?.regulator_warnings).filter((w) => w && (w.regulator || w.url)).length
}

function distinctJurisdictions(evidence) {
  const set = new Set()
  for (const w of asArray(evidence?.regulator_warnings)) {
    const j = w && typeof w.jurisdiction === 'string' ? w.jurisdiction.trim().toUpperCase() : ''
    if (j) set.add(j)
  }
  return set.size
}

function victimReportCount(evidence) {
  const vr = evidence?.victim_reports
  if (typeof vr === 'number' && Number.isFinite(vr)) return Math.max(0, Math.trunc(vr))
  if (Array.isArray(vr)) return vr.length
  if (vr && typeof vr === 'object' && Number.isFinite(vr.count)) return Math.max(0, Math.trunc(vr.count))
  return 0
}

/**
 * Evaluate the CONFIRMED evidentiary test.
 * @returns {{ satisfied: boolean, met: string[], missing: string[] }}
 */
function evaluateCorroboration(evidence) {
  const met = []
  const missing = []
  for (const t of CORROBORATION_TESTS) {
    if (t.satisfied(evidence || {})) met.push(t.key)
    else missing.push(t.describe)
  }
  return { satisfied: met.length > 0, met, missing }
}

// ─── Editorial override ───────────────────────────────────────────────────
//
// An override may only move the register DOWN (more cautious) or pin it where
// the evidence already allows. It can never manufacture permission for
// definitive scam language that the corroboration test denied — otherwise the
// override becomes a way to route around the methodology.
function normalizeOverride(raw) {
  if (!raw || typeof raw !== 'object') return null
  const classification = typeof raw.classification === 'string' ? raw.classification.trim().toUpperCase() : ''
  if (!CLASSIFICATIONS.includes(classification)) return null
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
  const analyst = typeof raw.analyst === 'string' ? raw.analyst.trim() : ''
  if (!reason || !analyst) return null // an unattributed, unexplained override is not an override
  return { classification, reason, analyst, set_at: raw.set_at || null }
}

const RANK = Object.freeze(
  Object.fromEntries(BANDS.map((b, i) => [b.classification, BANDS.length - i])), // CONFIRMED highest
)

// ─── The central function ─────────────────────────────────────────────────

/**
 * Map a numeric threat score (plus the evidence on file) to the editorial
 * register the copy is allowed to use.
 *
 * @param {number} rawScore
 * @param {object} [evidence] { regulator_warnings[], victim_reports }
 * @param {object} [options]  { override: { classification, reason, analyst } }
 * @returns {{
 *   score:number, scoreValid:boolean, scoreIssue:string|null,
 *   tier:string, classification:string, label:string, badge:string,
 *   prose:string, verdictOpener:string, languageRule:string,
 *   frameAsScam:boolean,
 *   scoreBand:string, downgraded:boolean,
 *   evidenceShortfall:string[]|null, corroboration:object,
 *   override:object|null,
 * }}
 */
function classifyThreat(rawScore, evidence = null, options = {}) {
  const { score, valid, reason } = normalizeScore(rawScore)
  const band = bandForScore(score)

  let effective = band
  let downgraded = false
  let evidenceShortfall = null

  const corroboration = evaluateCorroboration(evidence)

  // 1. Evidence gate — CONFIRMED needs more than a number.
  if (band.requiresCorroboration && !corroboration.satisfied) {
    effective = BANDS.find((b) => b.tier === 'high')
    downgraded = true
    evidenceShortfall = corroboration.missing
  }

  // 2. Editorial override — may only tighten, never loosen.
  const override = normalizeOverride(options.override)
  let overrideApplied = null
  if (override) {
    const target = BANDS.find((b) => b.classification === override.classification)
    if (target && RANK[target.classification] <= RANK[effective.classification]) {
      overrideApplied = override
      effective = target
      downgraded = downgraded || RANK[target.classification] < RANK[band.classification]
    } else if (target) {
      // Refused: an override cannot raise the register above what score +
      // evidence already permit. Recorded so the admin UI can say why.
      overrideApplied = {
        ...override,
        refused: true,
        refusedBecause: `override to ${override.classification} would raise the register above ${effective.classification}, which score ${score} and the evidence on file do not support`,
      }
    }
  }

  return {
    score,
    scoreValid: valid,
    scoreIssue: reason,
    tier: effective.tier,
    classification: effective.classification,
    label: effective.label,
    badge: effective.badge,
    prose: effective.prose,
    verdictOpener: effective.verdictOpener,
    languageRule: effective.languageRule,
    // Definitive fraud language requires BOTH the confirmed band AND evidence.
    frameAsScam: effective.frameAsScam === true && (!effective.requiresCorroboration || corroboration.satisfied),
    scoreBand: band.classification,
    downgraded,
    evidenceShortfall,
    corroboration,
    override: overrideApplied,
  }
}

/**
 * Pluck the CONFIRMED-gate evidence off a scam_brands row (or any object
 * carrying the same columns). Every call site that classifies a brand must
 * pass this — classifying from the score alone silently makes CONFIRMED
 * unreachable no matter what evidence is on file.
 */
function brandEvidence(brand) {
  if (!brand || typeof brand !== 'object') return null
  return {
    regulator_warnings: Array.isArray(brand.regulator_warnings) ? brand.regulator_warnings : [],
    victim_reports: brand.victim_reports ?? 0,
  }
}

module.exports = {
  BANDS,
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  CORROBORATION_TESTS,
  normalizeScore,
  bandForScore,
  evaluateCorroboration,
  classifyThreat,
  brandEvidence,
}
