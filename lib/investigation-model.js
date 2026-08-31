'use strict'

/**
 * lib/investigation-model.js — the canonical investigation record.
 * Phase 1, 2026-08-31.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The same fact was reachable from four places and they disagreed:
 *
 *   threat score   → reviews.scam_score  AND  scam_brands.scam_score
 *                    (33 of 34 rows disagree today; e.g. senvix 56 vs 47)
 *   days active    → scam_brands.lifespan_days  AND  a literal in prose
 *   celebrities    → scam_brands.total_celebrities  AND  celebrity_list[]
 *                    AND  a literal in prose  AND  item_list[]
 *   countries      → scam_brands.total_geos  AND  geo_list[]  AND prose
 *
 * `buildInvestigation()` resolves all of them ONCE, records where each value
 * came from, and is the only thing the page, the schema builder, the sync
 * payload and the validator are allowed to read. Nothing downstream re-derives
 * a metric from a raw column.
 *
 * ── Canonical-source policy ───────────────────────────────────────────────
 * `threat_score` is the investigation's own score (reviews.scam_score), NOT
 * the live brand score. That is deliberate:
 *
 *   - the published article's prose, title and schema were all written against
 *     the frozen score, so silently swapping in the live one would make the
 *     number disagree with every sentence around it;
 *   - the live score moves every night with the scraper, and a YMYL page whose
 *     headline number changes without an editorial pass is worse than a stale
 *     one.
 *
 * Instead the two are held to an invariant: at publish time they MUST match.
 * `score_drift` carries the delta and the validator raises it as a CRITICAL
 * failure, so the fix is an explicit re-score + regenerate rather than a
 * silent overwrite. See docs/REPLIT_PHASE1_INVESTIGATION_HANDOFF.md.
 *
 * ── Derived, never stored twice ───────────────────────────────────────────
 * `days_active` is computed from first_detected_date/last_checked_date every
 * time. scam_brands.lifespan_days is treated as an upstream cache and only
 * compared, never trusted.
 */

const { classifyThreat } = require('./threat-classification')
const { dedupeCelebrityList } = require('./threat-score')

const MS_PER_DAY = 86_400_000

// ─── date helpers ─────────────────────────────────────────────────────────

/** Parse anything date-ish to a Date, or null. Never throws. */
function toDate(v) {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** ISO calendar date (YYYY-MM-DD) or null. */
function toIsoDate(v) {
  const d = toDate(v)
  return d ? d.toISOString().slice(0, 10) : null
}

/**
 * Whole days between two dates, floored, never negative-by-accident.
 * Returns null when either end is missing, and a NEGATIVE number when `to`
 * precedes `from` — the caller (validator) needs to see impossible chronology
 * rather than have it clamped away.
 */
function daysBetween(from, to) {
  const a = toDate(from)
  const b = toDate(to)
  if (!a || !b) return null
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY)
}

// ─── domain helpers ───────────────────────────────────────────────────────

function hostnameOf(url) {
  if (typeof url !== 'string') return null
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * Hostnames seen in ad landing pages.
 *
 * IMPORTANT: these are the CLOAKED LANDER hostnames the ads point at
 * (fake-news domains like `breaking24.novinky-cz.com`), not the platform's
 * own domain. They are therefore offered as `domain_candidates` for an
 * analyst, and are never promoted to `primary_domain` automatically — doing
 * so would publish a factual claim the data does not support.
 */
function collectDomainCandidates(brand, landingPages) {
  const counts = new Map()
  const bump = (h) => {
    if (!h) return
    counts.set(h, (counts.get(h) || 0) + 1)
  }
  for (const row of Array.isArray(landingPages) ? landingPages : []) {
    bump(typeof row?.live_hostname === 'string' ? row.live_hostname.replace(/^www\./i, '').toLowerCase() : hostnameOf(row?.live_url))
  }
  for (const u of Array.isArray(brand?.landing_urls) ? brand.landing_urls : []) bump(hostnameOf(u))
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([hostname, observations]) => ({ hostname, observations }))
}

// ─── list helpers ─────────────────────────────────────────────────────────

function cleanStringArray(v) {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
}

function countOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.trunc(v))
  if (Array.isArray(v)) return v.length
  if (v && typeof v === 'object' && Number.isFinite(v.count)) return Math.max(0, Math.trunc(v.count))
  return 0
}

// ─── field registry ───────────────────────────────────────────────────────
//
// Drives the Evidence Snapshot table AND the "required fields" test. `render`
// decides whether a row appears at all — the brief is explicit that fields with
// no meaningful data must not be displayed rather than shown as "0" or "—".
const INVESTIGATION_FIELDS = Object.freeze([
  { key: 'threat_score', label: 'Threat score', required: true, source: 'reviews.scam_score', render: (i) => Number.isFinite(i.threat_score) },
  { key: 'threat_classification', label: 'Classification', required: true, source: 'derived: threat-classification', render: (i) => !!i.threat_classification },
  { key: 'first_detected_date', label: 'First detected', required: true, source: 'scam_brands.first_seen_at', render: (i) => !!i.first_detected_date },
  { key: 'last_checked_date', label: 'Last checked', required: true, source: 'scam_brands.last_seen_at', render: (i) => !!i.last_checked_date },
  { key: 'days_active', label: 'Days active', required: false, source: 'derived: last_checked − first_detected', render: (i) => Number.isFinite(i.days_active) && i.days_active > 0 },
  { key: 'creatives_observed', label: 'Creatives observed', required: false, source: 'scam_brands.total_creatives', render: (i) => i.creatives_observed > 0 },
  { key: 'countries_targeted', label: 'Countries targeted', required: false, source: 'scam_brands.geo_list', render: (i) => i.countries_targeted > 0 },
  { key: 'public_figures_impersonated', label: 'Public figures impersonated', required: false, source: 'scam_brands.celebrity_list (deduped)', render: (i) => i.public_figures_impersonated > 0 },
  { key: 'regulator_warnings', label: 'Regulatory warnings', required: false, source: 'scam_brands.regulator_warnings', render: (i) => i.regulator_warnings.length > 0 },
  { key: 'victim_reports', label: 'Victim reports', required: false, source: 'scam_brands.victim_reports', render: (i) => i.victim_reports > 0 },
  { key: 'primary_domain', label: 'Primary domain', required: false, source: 'scam_brands.primary_domain (analyst-set)', render: (i) => !!i.primary_domain },
  { key: 'analyst', label: 'Analyst', required: true, source: 'reviews.author_name / author_persona_id', render: (i) => !!i.analyst?.name },
])

const REQUIRED_FIELDS = Object.freeze(INVESTIGATION_FIELDS.filter((f) => f.required).map((f) => f.key))

// ─── the builder ──────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {object} args.review        a `reviews` row
 * @param {object} [args.brand]       the joined `scam_brands` row
 * @param {Array}  [args.landingPages] `brand_landing_pages` rows
 * @param {string} [args.siteUrl]
 * @returns {object} the canonical investigation record
 */
function buildInvestigation({ review, brand = null, landingPages = [], siteUrl = 'https://cryptokiller.org' } = {}) {
  if (!review || typeof review !== 'object') {
    throw new TypeError('buildInvestigation: `review` row is required')
  }
  const b = brand && typeof brand === 'object' ? brand : {}

  // ── dates ───────────────────────────────────────────────────────────────
  const first_detected_date = toIsoDate(b.first_seen_at)
  const last_checked_date = toIsoDate(b.last_seen_at) || toIsoDate(review.stats_synced_at)
  const days_active = daysBetween(first_detected_date, last_checked_date)
  const published_date = toIsoDate(review.published_at)
  const updated_date = toIsoDate(review.updated_at)

  // Upstream cache we compare against but never trust.
  const cached_lifespan_days = Number.isFinite(b.lifespan_days) ? b.lifespan_days : null

  // ── score ───────────────────────────────────────────────────────────────
  const frozen = typeof review.scam_score === 'number' && Number.isFinite(review.scam_score) ? review.scam_score : null
  const live = typeof b.scam_score === 'number' && Number.isFinite(b.scam_score) ? b.scam_score : null
  const threat_score = frozen !== null ? frozen : live
  const score_drift = frozen !== null && live !== null && frozen !== live ? { investigation: frozen, live_brand: live, delta: live - frozen } : null

  // ── evidence for the CONFIRMED gate ─────────────────────────────────────
  const regulator_warnings = Array.isArray(b.regulator_warnings) ? b.regulator_warnings.filter(Boolean) : []
  const regulators_checked = Array.isArray(b.regulators_checked) ? b.regulators_checked.filter(Boolean) : []
  const victim_reports = countOf(b.victim_reports)

  const threat = classifyThreat(
    threat_score,
    { regulator_warnings, victim_reports },
    // The review-level override is the analyst's decision about THIS
    // investigation; the brand-level one is shared context. More specific wins.
    // (Either can only tighten the register — see normalizeOverride.)
    { override: review.classification_override || b.classification_override || null },
  )

  // ── impersonated figures ────────────────────────────────────────────────
  // `celebrity_list` is stored capped, so when total_celebrities exceeds the
  // stored list the list is a SAMPLE. We expose both and mark it, so no page
  // can print a headline count it cannot name.
  const rawFigureList = cleanStringArray(b.celebrity_list)
  const namedFigures = dedupeCelebrityList(rawFigureList)
  const scrapedFigureCount = Number.isFinite(b.total_celebrities) ? b.total_celebrities : rawFigureList.length
  // Truncation is judged against the RAW stored list, because dedupe can only
  // shrink it. Two regimes follow:
  //   list complete  → the DEDUPED count is canonical. total_celebrities is a
  //     raw scraper tally that double-counts cross-script variants — trusting
  //     it here is the Floventra bug (page claimed 26, dedupe proved 24).
  //   list truncated → the stored names are a sample, so the scraper tally is
  //     the only count we hold; it is reported with list_complete=false and
  //     rendered as "N observed, M individually named".
  const figure_list_complete = scrapedFigureCount <= rawFigureList.length
  const public_figures_impersonated = figure_list_complete ? namedFigures.length : scrapedFigureCount

  // ── geos ────────────────────────────────────────────────────────────────
  const geoList = cleanStringArray(b.geo_list)
  const countries_targeted = geoList.length || (Number.isFinite(b.total_geos) ? b.total_geos : 0)

  const domain_candidates = collectDomainCandidates(b, landingPages)

  const investigation = {
    // identity
    id: review.id || null,
    slug: review.slug || b.slug || null,
    brand_id: b.id || review.brand_id || null,
    brand_name: b.name || review.title || null,
    url: review.slug ? `${siteUrl.replace(/\/$/, '')}/review/${review.slug}` : null,

    // domains — analyst-set, never inferred (see collectDomainCandidates)
    primary_domain: typeof b.primary_domain === 'string' && b.primary_domain.trim() ? b.primary_domain.trim().toLowerCase() : null,
    alternate_domains: cleanStringArray(b.alternate_domains).map((d) => d.toLowerCase()),
    domain_candidates,

    // score + classification
    threat_score,
    threat_score_valid: threat.scoreValid,
    threat_score_issue: threat.scoreIssue,
    live_brand_score: live,
    score_drift,
    threat_classification: threat.classification,
    threat_classification_label: threat.label,
    threat_badge: threat.badge,
    threat_tier: threat.tier,
    frame_as_scam: threat.frameAsScam,
    language_rule: threat.languageRule,
    classification_downgraded: threat.downgraded,
    evidence_shortfall: threat.evidenceShortfall,
    classification_override: threat.override,
    threat,

    // status + chronology
    investigation_status: review.status || b.review_status || null,
    first_detected_date,
    last_checked_date,
    days_active,
    cached_lifespan_days,
    published_date,
    updated_date,

    // surveillance metrics
    creatives_observed: Number.isFinite(b.total_creatives) ? b.total_creatives : 0,
    weekly_velocity: Number.isFinite(b.velocity_7d) ? b.velocity_7d : null,
    countries_targeted,
    country_codes: geoList,
    public_figures_impersonated,
    public_figures_named: namedFigures,
    public_figure_list_complete: figure_list_complete,

    // external corroboration
    regulators_checked,
    regulator_warnings,
    victim_reports,

    // evidence + provenance
    evidence_sources: Array.isArray(review.sources) ? review.sources.filter(Boolean) : [],
    citations: Array.isArray(review.citations) ? review.citations.filter(Boolean) : [],
    evidence_items: Array.isArray(review.evidence_items) ? review.evidence_items.filter(Boolean) : [],
    scam_types: cleanStringArray(b.scam_types),
    detected_platforms: cleanStringArray(b.detected_platforms),
    entity_type: b.entity_type || null,

    // editorial
    summary: typeof review.summary === 'string' ? review.summary : '',
    verdict: typeof review.verdict === 'string' ? review.verdict : '',
    analyst: {
      id: review.author_persona_id || null,
      name: review.author_name || null,
      credentials: review.author_credentials || null,
    },
  }

  return investigation
}

/** Rows for the Evidence Snapshot table — only fields that carry real data. */
function evidenceSnapshotRows(investigation) {
  const fmt = {
    threat_score: (i) => `${i.threat_score}/100`,
    threat_classification: (i) => i.threat_classification_label,
    days_active: (i) => `${i.days_active.toLocaleString('en-US')}`,
    creatives_observed: (i) => i.creatives_observed.toLocaleString('en-US'),
    countries_targeted: (i) => i.countries_targeted.toLocaleString('en-US'),
    public_figures_impersonated: (i) =>
      i.public_figure_list_complete
        ? i.public_figures_impersonated.toLocaleString('en-US')
        // The stored name list is capped, so the observed count and the number
        // we can actually name differ. Both are shown rather than printing a
        // headline figure the page cannot back with names.
        : `${i.public_figures_impersonated.toLocaleString('en-US')} observed, ${i.public_figures_named.length.toLocaleString('en-US')} individually named`,
    regulator_warnings: (i) => String(i.regulator_warnings.length),
    victim_reports: (i) => String(i.victim_reports),
    analyst: (i) => i.analyst.name,
  }
  return INVESTIGATION_FIELDS.filter((f) => {
    try {
      return f.render(investigation)
    } catch {
      return false
    }
  }).map((f) => ({
    key: f.key,
    label: f.label,
    value: fmt[f.key] ? fmt[f.key](investigation) : String(investigation[f.key]),
    source: f.source,
  }))
}

/** The shape every consumer of a "related investigation" card gets. */
function investigationSummary(investigation) {
  return {
    brand: investigation.brand_name,
    score: investigation.threat_score,
    classification: investigation.threat_classification,
    classification_label: investigation.threat_classification_label,
    last_checked: investigation.last_checked_date,
    primary_scam_type: investigation.scam_types[0] || null,
    key_observed_metric: keyObservedMetric(investigation),
    url: investigation.url,
  }
}

/** The single most load-bearing OBSERVED number, for one-line summaries. */
function keyObservedMetric(i) {
  if (i.creatives_observed > 0) {
    return { key: 'creatives_observed', value: i.creatives_observed, label: i.creatives_observed === 1 ? 'ad creative observed' : 'ad creatives observed' }
  }
  if (i.countries_targeted > 0) {
    return { key: 'countries_targeted', value: i.countries_targeted, label: i.countries_targeted === 1 ? 'country targeted' : 'countries targeted' }
  }
  if (i.public_figures_impersonated > 0) {
    return { key: 'public_figures_impersonated', value: i.public_figures_impersonated, label: 'public figures impersonated' }
  }
  return null
}

module.exports = {
  INVESTIGATION_FIELDS,
  REQUIRED_FIELDS,
  buildInvestigation,
  evidenceSnapshotRows,
  investigationSummary,
  keyObservedMetric,
  daysBetween,
  toIsoDate,
  toDate,
  collectDomainCandidates,
}
