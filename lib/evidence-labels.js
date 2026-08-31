'use strict'

/**
 * lib/evidence-labels.js — the four evidence classes.
 * Phase 1, 2026-08-31.
 *
 * Every material finding on an investigation page carries one of these, and
 * this module is the ONLY place that decides which. The point is that a reader
 * (and an answer engine lifting the sentence) can tell what kind of thing they
 * are being told:
 *
 *   OBSERVED    Crypto Killer's own surveillance captured it. First-party.
 *   REGULATORY  A regulator, court, government body or company register said it.
 *   REPORTED    A victim or user said it. True as a report; unverified as fact.
 *   INFERRED    An analyst's conclusion from patterns or infrastructure.
 *
 * The hard rule the code enforces: a finding may never be *upgraded* — an
 * INFERRED or REPORTED claim rendered with OBSERVED styling is the exact
 * failure mode that makes a YMYL page defamatory. `classifyEvidence()`
 * therefore falls back to INFERRED (the weakest class) whenever the class is
 * missing or unrecognised, never to OBSERVED.
 */

const EVIDENCE_CLASSES = Object.freeze({
  OBSERVED: {
    key: 'OBSERVED',
    label: 'OBSERVED',
    strength: 4,
    definition: 'Directly captured by Crypto Killer surveillance or investigation systems.',
    // Copy written under this class may state the finding as fact.
    assertsFact: true,
    attribution: null,
    // Tailwind-ish tokens; the component maps these, nothing else does.
    tone: 'observed',
  },
  REGULATORY: {
    key: 'REGULATORY',
    label: 'REGULATORY',
    strength: 4,
    definition:
      'Supported by a regulator, government body, court, company register or comparably authoritative external record.',
    assertsFact: true,
    attribution: 'source',
    tone: 'regulatory',
  },
  REPORTED: {
    key: 'REPORTED',
    label: 'REPORTED',
    strength: 2,
    definition: 'Based on victim or user reports, and identified as such.',
    // A report is a fact ABOUT a report, never about the entity.
    assertsFact: false,
    attribution: 'reporter',
    tone: 'reported',
  },
  INFERRED: {
    key: 'INFERRED',
    label: 'INFERRED',
    strength: 1,
    definition:
      'An analytical conclusion drawn from patterns, infrastructure similarity, campaign behaviour or other indirect evidence.',
    assertsFact: false,
    attribution: 'analysis',
    tone: 'inferred',
  },
})

const EVIDENCE_CLASS_KEYS = Object.freeze(Object.keys(EVIDENCE_CLASSES))

/** Classes whose copy is allowed to state the finding as settled fact. */
const FACT_ASSERTING = Object.freeze(
  EVIDENCE_CLASS_KEYS.filter((k) => EVIDENCE_CLASSES[k].assertsFact),
)

/**
 * Resolve a raw class string to a known class.
 * Unknown / missing → INFERRED. Never OBSERVED: an unlabelled claim is an
 * unverified one, and defaulting up would launder analysis into fact.
 */
function classifyEvidence(raw) {
  const key = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return EVIDENCE_CLASSES[key] || EVIDENCE_CLASSES.INFERRED
}

/** True when `raw` names a real class (so the validator can flag mislabels). */
function isKnownEvidenceClass(raw) {
  const key = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return Object.prototype.hasOwnProperty.call(EVIDENCE_CLASSES, key)
}

/**
 * Normalise one evidence item into the shape the UI and validator both read.
 *
 * @param {object} raw { claim, evidence_class, source_url, observed_from,
 *                       observed_to, metric_key, reporter }
 */
function normalizeEvidenceItem(raw, index = 0) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const cls = classifyEvidence(r.evidence_class)
  return {
    id: r.id || `evidence-${index + 1}`,
    claim: typeof r.claim === 'string' ? r.claim.trim() : '',
    evidence_class: cls.key,
    // Preserved so the validator can report "this said OBSERVEDD" rather than
    // silently treating it as INFERRED.
    declared_class: typeof r.evidence_class === 'string' ? r.evidence_class.trim().toUpperCase() : null,
    class_recognised: isKnownEvidenceClass(r.evidence_class),
    source_url: typeof r.source_url === 'string' && /^https?:\/\//i.test(r.source_url) ? r.source_url : null,
    observed_from: typeof r.observed_from === 'string' ? r.observed_from.slice(0, 10) : null,
    observed_to: typeof r.observed_to === 'string' ? r.observed_to.slice(0, 10) : null,
    metric_key: typeof r.metric_key === 'string' ? r.metric_key : null,
    reporter: typeof r.reporter === 'string' ? r.reporter : null,
  }
}

function normalizeEvidenceItems(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeEvidenceItem).filter((e) => e.claim)
}

/**
 * Build the OBSERVED findings the surveillance data supports on its own, so a
 * page has real evidence-labelled statements even before an analyst writes
 * any. Every sentence is generated from the canonical record — no literals —
 * and each one names its subject rather than opening with a pronoun, so it
 * survives being extracted on its own.
 *
 * @param {object} investigation from lib/investigation-model.js
 */
function derivedObservedFindings(investigation) {
  const i = investigation || {}
  const name = i.brand_name || 'This platform'
  const out = []
  const window =
    i.first_detected_date && i.last_checked_date
      ? ` between ${i.first_detected_date} and ${i.last_checked_date}`
      : ''

  if (i.creatives_observed > 0) {
    out.push({
      id: 'observed-creatives',
      evidence_class: 'OBSERVED',
      metric_key: 'creatives_observed',
      claim: `Crypto Killer catalogued ${i.creatives_observed.toLocaleString('en-US')} advertising creatives promoting ${name}${window}.`,
      observed_from: i.first_detected_date,
      observed_to: i.last_checked_date,
    })
  }
  if (i.public_figures_impersonated > 0) {
    const named = i.public_figures_named.slice(0, 3).join(', ')
    out.push({
      id: 'observed-figures',
      evidence_class: 'OBSERVED',
      metric_key: 'public_figures_impersonated',
      claim:
        `Crypto Killer recorded ${i.public_figures_impersonated.toLocaleString('en-US')} public figures whose likeness appeared in ${name} advertising${window}` +
        (named ? `, including ${named}.` : '.'),
      observed_from: i.first_detected_date,
      observed_to: i.last_checked_date,
    })
  }
  if (i.countries_targeted > 0) {
    out.push({
      id: 'observed-geos',
      evidence_class: 'OBSERVED',
      metric_key: 'countries_targeted',
      claim: `${name} advertising was observed targeting ${i.countries_targeted.toLocaleString('en-US')} countries${window}.`,
      observed_from: i.first_detected_date,
      observed_to: i.last_checked_date,
    })
  }
  if (Number.isFinite(i.days_active) && i.days_active > 0) {
    out.push({
      id: 'observed-longevity',
      evidence_class: 'INFERRED',
      metric_key: 'days_active',
      claim: `${name} campaigns remained active for ${i.days_active.toLocaleString('en-US')} days between first detection and the most recent check.`,
      observed_from: i.first_detected_date,
      observed_to: i.last_checked_date,
    })
  }
  for (const w of Array.isArray(i.regulator_warnings) ? i.regulator_warnings : []) {
    if (!w || (!w.regulator && !w.url)) continue
    out.push({
      id: `regulatory-${(w.regulator || 'warning').toLowerCase().replace(/\W+/g, '-')}`,
      evidence_class: 'REGULATORY',
      metric_key: 'regulator_warnings',
      claim: `${w.regulator || 'A financial regulator'}${w.jurisdiction ? ` (${w.jurisdiction})` : ''} published a warning naming ${name}${w.published_at ? ` on ${String(w.published_at).slice(0, 10)}` : ''}.`,
      source_url: typeof w.url === 'string' ? w.url : null,
    })
  }
  if (i.victim_reports > 0) {
    out.push({
      id: 'reported-victims',
      evidence_class: 'REPORTED',
      metric_key: 'victim_reports',
      claim: `${i.victim_reports.toLocaleString('en-US')} user reports naming ${name} have been submitted to Crypto Killer. These are reports, not independently verified losses.`,
    })
  }
  return normalizeEvidenceItems(out)
}

module.exports = {
  EVIDENCE_CLASSES,
  EVIDENCE_CLASS_KEYS,
  FACT_ASSERTING,
  classifyEvidence,
  isKnownEvidenceClass,
  normalizeEvidenceItem,
  normalizeEvidenceItems,
  derivedObservedFindings,
}
