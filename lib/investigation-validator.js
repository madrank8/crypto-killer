'use strict'

/**
 * lib/investigation-validator.js — the editorial consistency validator.
 * Phase 1, 2026-08-31.
 *
 * Runs against the CANONICAL record (lib/investigation-model.js) plus the raw
 * review row, and returns findings at two severities:
 *
 *   CRITICAL  the page asserts something our own data contradicts, or states
 *             a fraud claim the evidence does not carry. Blocks publish.
 *   WARNING   the page is publishable but something is missing, stale or
 *             harder to extract than it should be. Never blocks.
 *
 * Every finding names the exact values involved. A finding that says "check
 * the dates" gets ignored; one that says "last_checked 2026-08-13 precedes
 * first_detected 2026-09-01" gets fixed.
 *
 * Determinism is the whole point — no model calls — so this is cheap enough
 * to run on every publish attempt and in a nightly sweep over the archive.
 */

const { buildInvestigation, daysBetween } = require('./investigation-model')
const { normalizeEvidenceItems, isKnownEvidenceClass, FACT_ASSERTING } = require('./evidence-labels')
const {
  findDefinitiveFraudClaim,
  findSourceRequiringClaims,
  hasAmbiguousOpener,
} = require('./editorial-language')
const { BANDS, bandForScore } = require('./threat-classification')

const SEVERITY = Object.freeze({ CRITICAL: 'critical', WARNING: 'warning' })

/** How stale `last_checked_date` may get before it is worth flagging. */
const STALE_LAST_CHECKED_DAYS = 45

/** Metric literals we can safely recognise in prose, mapped to canonical keys. */
const METRIC_PATTERNS = Object.freeze([
  {
    key: 'days_active',
    label: 'days active',
    re: /\b([\d][\d,]*)\s*(?:\+)?\s*days?\s+(?:of\s+)?(?:active\s+)?(?:operation|activity|campaign|running|continuous)/gi,
  },
  {
    key: 'countries_targeted',
    label: 'countries targeted',
    re: /\b([\d][\d,]*)\s*(?:\+)?\s*(?:countries|nations|jurisdictions|geographies)\b/gi,
  },
  {
    key: 'public_figures_impersonated',
    label: 'public figures impersonated',
    re: /\b([\d][\d,]*)\s*(?:\+)?\s*(?:celebrities|public\s+figures|celebrity\s+identities)\b/gi,
  },
  {
    key: 'creatives_observed',
    label: 'creatives observed',
    re: /\b([\d][\d,]*)\s*(?:\+)?\s*(?:ad\s+)?creatives\b/gi,
  },
])

const toInt = (s) => {
  const n = Number(String(s).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : null
}

// Tags become a SENTINEL, not a space. Stat cards render as
// `<span>Ad Creatives</span><span>71</span><span>Countries</span><span>2</span>`,
// and stripping to whitespace turns that into "71 Countries" — a metric claim
// nobody wrote. The sentinel is non-whitespace, so a metric regex cannot span
// two elements, while text inside one element still reads normally.
const TAG_SENTINEL = '\u00a6'
// Inline FORMATTING tags are removed outright: the generated articles write
// numbers as `across <strong style=…>9</strong> countries`, and a sentinel
// there would hide the claim from the metric scanner (a false negative on the
// exact pattern the corpus uses). span/div/p and everything else still become
// the sentinel, because stat-card markup renders adjacent cells whose text
// must not fuse into phantom claims ("…71¦Countries 2…").
const INLINE_TAG_RE = /<\/?(?:strong|em|b|i|u|a|mark|abbr|time|small|sup|sub)\b[^>]*>/gi
const stripHtml = (s) =>
  typeof s === 'string'
    ? s.replace(INLINE_TAG_RE, '').replace(/<[^>]+>/g, TAG_SENTINEL).replace(/[ \t]+/g, ' ')
    : ''
/** Human-readable form (sentinels back to spaces) for quoting in a message. */
const readable = (s) => String(s || '').replace(/\u00a6/g, ' ').replace(/\s+/g, ' ').trim()

// Prose that describes CRYPTO KILLER's own scale rather than this brand's.
// "a reference database of 12,300 public figures" is a platform figure; scoring
// it against this brand's celebrity count is the mistake documented at length
// in lib/review-stat-tokenizer.js.
const PLATFORM_CONTEXT = /(reference database|our database|across our|crypto killer (?:tracks|monitors|has)|brands tracked|we monitor|platform-wide|\{\{platform_stat)/i

// Fields whose text is platform boilerplate, not per-brand claims.
const PLATFORM_SCALE_FIELDS = new Set(['methodology', 'disclaimer', 'ai_disclosure'])

/** Every human-prose field, labelled, so a finding can point at a field. */
function collectProse(review) {
  const out = []
  const push = (label, val) => {
    if (typeof val === 'string' && val.trim()) out.push({ label, text: val })
  }
  push('title', review.title)
  push('headline', review.headline)
  push('alternative_headline', review.alternative_headline)
  push('meta_description', review.meta_description)
  push('summary', review.summary)
  push('verdict', review.verdict)
  push('how_it_works', review.how_it_works)
  push('not_for_you', review.not_for_you)
  push('protection_steps', review.protection_steps)
  push('methodology', review.methodology)
  push('expertise_depth', review.expertise_depth)
  push('full_article', review.full_article)
  ;(Array.isArray(review.key_takeaways) ? review.key_takeaways : []).forEach((k, i) => push(`key_takeaways[${i}]`, k))
  ;(Array.isArray(review.experience_signals) ? review.experience_signals : []).forEach((k, i) => push(`experience_signals[${i}]`, k))
  push('information_gain_summary', review.information_gain_summary)
  ;(Array.isArray(review.red_flags) ? review.red_flags : []).forEach((r, i) => {
    push(`red_flags[${i}].flag`, r?.flag || r?.title)
    push(`red_flags[${i}].detail`, r?.detail || r?.description)
  })
  ;(Array.isArray(review.faq) ? review.faq : []).forEach((f, i) => {
    push(`faq[${i}].question`, f?.question)
    push(`faq[${i}].answer`, f?.answer)
  })
  return out
}

function finding(code, severity, field, message, extra = {}) {
  return { code, severity, field, message, ...extra }
}

/**
 * @param {object} args
 * @param {object} args.review          a `reviews` row
 * @param {object} [args.brand]         the joined `scam_brands` row
 * @param {Array}  [args.landingPages]
 * @param {object} [args.investigation] prebuilt canonical record (optional)
 * @param {Date}   [args.now]           injectable for tests
 * @returns {{ ok:boolean, canPublish:boolean, findings:Array,
 *             critical:Array, warnings:Array, investigation:object }}
 */
function validateInvestigation(args = {}) {
  const { review, brand = null, landingPages = [], now = new Date() } = args
  if (!review || typeof review !== 'object') throw new TypeError('validateInvestigation: `review` row is required')

  const investigation = args.investigation || buildInvestigation({ review, brand, landingPages })
  const f = []
  const i = investigation
  const prose = collectProse(review)
  const corpus = prose.map((p) => stripHtml(p.text)).join('\n')

  // ══ 1. Score sanity ══════════════════════════════════════════════════════
  if (i.threat_score === null || i.threat_score === undefined) {
    f.push(finding('SCORE_MISSING', SEVERITY.CRITICAL, 'threat_score',
      'No threat score on the investigation or the brand row. Every displayed metric on the page derives from this; nothing can be classified without it.'))
  } else if (!i.threat_score_valid) {
    f.push(finding('SCORE_INVALID', SEVERITY.CRITICAL, 'threat_score',
      `Threat score ${JSON.stringify(review.scam_score)} is not a finite number in 0-100 (${i.threat_score_issue}). Clamped to ${i.threat_score} for rendering, but the stored value must be corrected.`,
      { current: review.scam_score }))
  }

  // ══ 2. Score ↔ classification agreement ══════════════════════════════════
  // The classification may legitimately sit BELOW the score's band (evidence
  // gate or editorial override). It may never sit above it.
  if (Number.isFinite(i.threat_score)) {
    const band = bandForScore(i.threat_score)
    const rank = (c) => BANDS.length - BANDS.findIndex((b) => b.classification === c)
    if (rank(i.threat_classification) > rank(band.classification)) {
      f.push(finding('CLASSIFICATION_ABOVE_SCORE', SEVERITY.CRITICAL, 'threat_classification',
        `Classification ${i.threat_classification} is stronger than score ${i.threat_score} supports (band ${band.classification}).`))
    }
    if (i.classification_override?.refused) {
      f.push(finding('OVERRIDE_REFUSED', SEVERITY.WARNING, 'classification_override',
        `Editorial override to ${i.classification_override.classification} was refused: ${i.classification_override.refusedBecause}`))
    }
  }

  // ══ 3. Canonical metric contradiction — score stored twice ═══════════════
  if (i.score_drift) {
    f.push(finding('SCORE_DRIFT', SEVERITY.CRITICAL, 'threat_score',
      `The investigation asserts ${i.score_drift.investigation}/100 while the live brand score is ${i.score_drift.live_brand}/100 (delta ${i.score_drift.delta > 0 ? '+' : ''}${i.score_drift.delta}). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy.`,
      { current: i.score_drift }))
  }

  // ══ 4. Date chronology ═══════════════════════════════════════════════════
  if (i.first_detected_date && i.last_checked_date) {
    const span = daysBetween(i.first_detected_date, i.last_checked_date)
    if (span < 0) {
      f.push(finding('DATE_CHRONOLOGY_IMPOSSIBLE', SEVERITY.CRITICAL, 'last_checked_date',
        `last_checked_date ${i.last_checked_date} precedes first_detected_date ${i.first_detected_date}.`))
    }
  }
  if (!i.last_checked_date) {
    f.push(finding('LAST_CHECKED_MISSING', SEVERITY.WARNING, 'last_checked_date',
      'No last-checked date. The Current Assessment block and dateModified both depend on it.'))
  } else {
    const age = daysBetween(i.last_checked_date, now)
    if (Number.isFinite(age) && age > STALE_LAST_CHECKED_DAYS) {
      f.push(finding('LAST_CHECKED_STALE', SEVERITY.WARNING, 'last_checked_date',
        `Last checked ${i.last_checked_date}, ${age} days ago (threshold ${STALE_LAST_CHECKED_DAYS}). A surveillance page whose "last checked" is months old undercuts the claim it is monitored.`,
        { current: i.last_checked_date }))
    }
  }
  if (!i.first_detected_date) {
    f.push(finding('FIRST_DETECTED_MISSING', SEVERITY.WARNING, 'first_detected_date',
      'No first-detected date, so days_active cannot be derived and the observation window is unstated.'))
  }
  if (i.published_date && i.updated_date && i.published_date > i.updated_date) {
    f.push(finding('PUBLISHED_AFTER_UPDATED', SEVERITY.CRITICAL, 'published_date',
      `published_date ${i.published_date} is later than updated_date ${i.updated_date}. datePublished/dateModified in the schema will be inverted.`))
  }

  // ══ 5. days_active consistency with its own source dates ═════════════════
  if (Number.isFinite(i.days_active) && Number.isFinite(i.cached_lifespan_days)) {
    const delta = Math.abs(i.days_active - i.cached_lifespan_days)
    if (delta > 1) {
      f.push(finding('DAYS_ACTIVE_CACHE_DRIFT', SEVERITY.WARNING, 'days_active',
        `Derived days_active is ${i.days_active} but scam_brands.lifespan_days caches ${i.cached_lifespan_days} (delta ${delta}). The derived value is authoritative; the cache is stale.`,
        { current: { derived: i.days_active, cached: i.cached_lifespan_days } }))
    }
  }

  // ══ 6. Metric literals in prose vs canonical values ══════════════════════
  // Two failure shapes: a literal that disagrees with canon, and two literals
  // for the same metric that disagree with EACH OTHER.
  for (const { key, label, re } of METRIC_PATTERNS) {
    const canonical = i[key]
    const seen = new Map() // value → first field it appeared in
    for (const { label: field, text } of prose) {
      if (PLATFORM_SCALE_FIELDS.has(field)) continue
      const plain = stripHtml(text)
      re.lastIndex = 0
      let m
      while ((m = re.exec(plain)) !== null) {
        const v = toInt(m[1])
        if (v === null || v <= 0) continue
        // A number introduced as platform scale is not a claim about this brand.
        if (PLATFORM_CONTEXT.test(plain.slice(Math.max(0, m.index - 90), m.index))) continue
        if (!seen.has(v)) seen.set(v, field)
      }
    }
    const values = [...seen.keys()]
    if (values.length > 1) {
      f.push(finding('METRIC_SELF_CONTRADICTION', SEVERITY.CRITICAL, key,
        `The page states more than one value for ${label}: ${values.map((v) => `${v} (${seen.get(v)})`).join(', ')}. Both should interpolate the canonical field.`,
        { current: Object.fromEntries(seen) }))
    }
    if (Number.isFinite(canonical) && canonical > 0) {
      const wrong = values.filter((v) => v !== canonical)
      if (wrong.length > 0) {
        f.push(finding('METRIC_LITERAL_DRIFT', SEVERITY.CRITICAL, key,
          `Prose states ${wrong.join(', ')} ${label} but the canonical value is ${canonical} (${wrong.map((v) => seen.get(v)).join(', ')}). Interpolate from the canonical record instead of typing the number.`,
          { current: wrong, canonical }))
      } else if (values.length > 0) {
        f.push(finding('METRIC_HARDCODED', SEVERITY.WARNING, key,
          `${values[0]} ${label} matches the canonical value today but is a literal in ${seen.get(values[0])} and will drift the next time the scraper runs.`))
      }
    }
  }

  // ══ 7. Editorial register vs evidence ════════════════════════════════════
  {
    const position = { frameAsScam: i.frame_as_scam, classification: i.threat_classification }
    for (const { label: field, text } of prose) {
      const hit = findDefinitiveFraudClaim(stripHtml(text), position)
      if (!hit) continue
      const why =
        hit.kind === 'assertion'
          ? `states fraud as settled fact, but this investigation is classified ${i.threat_classification} (${i.threat_score}/100)${i.evidence_shortfall ? ` and lacks ${i.evidence_shortfall.join(' / ')}` : ''}`
          : `instructs the reader as though the platform were established as unsafe, but this investigation is classified ${i.threat_classification} (${i.threat_score}/100), where the page also states that the evidence is not sufficient`
      f.push(finding('DEFINITIVE_CLAIM_UNSUPPORTED', SEVERITY.CRITICAL, field,
        `"${hit.phrase}" ${why}. ${i.language_rule}`,
        { current: readable(hit.context), claim_kind: hit.kind }))
      break // one finding is enough to block; don't spam the report
    }
  }
  if (i.classification_downgraded && i.evidence_shortfall) {
    f.push(finding('CONFIRMED_EVIDENCE_SHORTFALL', SEVERITY.WARNING, 'threat_classification',
      `Score ${i.threat_score} sits in the CONFIRMED band but the methodology's evidentiary test is unmet (needs ${i.evidence_shortfall.join(' or ')}). Presented as ${i.threat_classification} until one is recorded.`))
  }

  // ══ 8. Strong allegations need sources ═══════════════════════════════════
  const sourceCount = i.evidence_sources.length + i.citations.length
  const allegations = findSourceRequiringClaims(corpus)
  if (allegations.length > 0 && sourceCount === 0) {
    f.push(finding('STRONG_CLAIM_UNSOURCED', SEVERITY.CRITICAL, 'sources',
      `The article makes ${allegations.length} allegation(s) requiring external support (${allegations.map((a) => a.key).join(', ')}) but carries no sources or citations. First: "${allegations[0].phrase}".`,
      { current: allegations.map((a) => a.phrase) }))
  } else if (sourceCount === 0) {
    f.push(finding('NO_EVIDENCE_SOURCE', SEVERITY.WARNING, 'sources',
      'No evidence sources or citations recorded on this investigation.'))
  }

  // ══ 9. Required fields ═══════════════════════════════════════════════════
  if (!i.analyst.name) {
    f.push(finding('ANALYST_MISSING', SEVERITY.WARNING, 'analyst',
      'No analyst recorded. Person/author structured data and the byline both need one.'))
  }
  if (!i.primary_domain) {
    f.push(finding('PRIMARY_DOMAIN_MISSING', SEVERITY.WARNING, 'primary_domain',
      `No primary domain recorded.${i.domain_candidates.length ? ` ${i.domain_candidates.length} landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: ${i.domain_candidates[0].hostname}.` : ''}`,
      { current: i.domain_candidates.slice(0, 5).map((d) => d.hostname) }))
  }
  if (!i.investigation_status) {
    f.push(finding('STATUS_MISSING', SEVERITY.WARNING, 'investigation_status', 'No investigation status on the record.'))
  }

  // ══ 10. Evidence-item labelling ══════════════════════════════════════════
  const items = normalizeEvidenceItems(review.evidence_items)
  items.forEach((it, n) => {
    if (it.declared_class && !it.class_recognised) {
      f.push(finding('EVIDENCE_CLASS_UNKNOWN', SEVERITY.CRITICAL, `evidence_items[${n}]`,
        `Evidence class "${it.declared_class}" is not one of OBSERVED / REGULATORY / REPORTED / INFERRED. Treated as INFERRED so nothing is upgraded by accident.`))
    }
    if (FACT_ASSERTING.includes(it.evidence_class) && it.evidence_class === 'REGULATORY' && !it.source_url) {
      f.push(finding('REGULATORY_ITEM_NO_SOURCE', SEVERITY.CRITICAL, `evidence_items[${n}]`,
        `A REGULATORY finding asserts an external authority said something but carries no source URL: "${it.claim.slice(0, 120)}".`))
    }
  })

  // ══ 11. Duplicated text blocks ═══════════════════════════════════════════
  // full_article is a superset of the short prose fields by construction (the
  // writer composes the body FROM them), so comparing it against them reports a
  // duplicate on every single review. What is worth flagging is a passage
  // repeated inside the body, or shared between two short fields.
  const dupes = [
    ...findDuplicateBlocks(prose.filter((x) => x.label !== 'full_article')),
    ...findRepeatedBlocksWithin(prose.find((x) => x.label === 'full_article')),
  ]
  for (const d of dupes) {
    f.push(finding('DUPLICATE_TEXT_BLOCK', SEVERITY.WARNING, d.fields.join(' + '),
      `The same ~${d.length}-character passage appears in ${d.fields.length} places: "${d.sample}".`))
  }

  // ══ 12. AI retrievability ════════════════════════════════════════════════
  const ambiguous = findAmbiguousOpeners(review)
  if (ambiguous.length > 0) {
    f.push(finding('AMBIGUOUS_PARAGRAPH_OPENER', SEVERITY.WARNING, 'full_article',
      `${ambiguous.length} extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "${ambiguous[0].slice(0, 120)}".`,
      { current: ambiguous.slice(0, 5) }))
  }

  const critical = f.filter((x) => x.severity === SEVERITY.CRITICAL)
  const warnings = f.filter((x) => x.severity === SEVERITY.WARNING)

  return {
    ok: f.length === 0,
    canPublish: critical.length === 0,
    findings: f,
    critical,
    warnings,
    investigation: i,
    blockReason: critical.length
      ? `${critical.length} critical validation failure(s): ${critical.map((c) => `${c.code} (${c.field})`).join(', ')}`
      : null,
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Passages of 120+ characters that appear verbatim in two or more fields.
 * 120 is long enough that boilerplate disclaimers (which legitimately repeat)
 * are caught deliberately, while shared sentence fragments are not.
 */
function findDuplicateBlocks(prose, minLength = 120) {
  const index = new Map()
  for (const { label, text } of prose) {
    const plain = stripHtml(text).trim()
    if (plain.length < minLength) continue
    // Compare on normalised paragraph granularity.
    for (const para of plain.split(/(?<=[.!?])\s{1,}(?=[A-Z])/)) {
      const key = para.trim().toLowerCase().replace(/\s+/g, ' ')
      if (key.length < minLength) continue
      if (!index.has(key)) index.set(key, new Set())
      index.get(key).add(label)
    }
  }
  const out = []
  for (const [key, fields] of index) {
    if (fields.size > 1) {
      out.push({ length: key.length, fields: [...fields], sample: key.slice(0, 120) })
    }
  }
  return out.slice(0, 10)
}

/** Extractable blocks in the article body that open with a bare pronoun. */
function findAmbiguousOpeners(review) {
  const html = typeof review.full_article === 'string' ? review.full_article : ''
  const blocks = html
    ? [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripHtml(m[1]).trim())
    : []
  const extra = (Array.isArray(review.faq) ? review.faq : []).map((q) => stripHtml(q?.answer || '').trim())
  return [...blocks, ...extra].filter(hasAmbiguousOpener).slice(0, 20)
}

/**
 * A passage repeated two or more times INSIDE one field. Unlike the
 * cross-field check this is always a real duplication — the same sentences
 * printed twice on the page.
 */
function findRepeatedBlocksWithin(field, minLength = 120) {
  if (!field) return []
  const plain = stripHtml(field.text)
  const counts = new Map()
  for (const para of plain.split(/(?<=[.!?])\s{1,}(?=[A-Z])|\u00a6/)) {
    const key = readable(para).toLowerCase()
    if (key.length < minLength) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const out = []
  for (const [key, n] of counts) {
    if (n > 1) out.push({ length: key.length, fields: [`${field.label} (×${n})`], sample: key.slice(0, 120) })
  }
  return out.slice(0, 5)
}

module.exports = {
  SEVERITY,
  findRepeatedBlocksWithin,
  STALE_LAST_CHECKED_DAYS,
  METRIC_PATTERNS,
  validateInvestigation,
  collectProse,
  findDuplicateBlocks,
  findAmbiguousOpeners,
}
