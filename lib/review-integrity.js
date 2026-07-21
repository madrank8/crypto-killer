'use strict'

// Deterministic integrity checks for a published review.
//
// The quality audit is LLM-judged (`hard_fail_checks.any_hard_fail`). That works
// for prose quality, but a model reading an article cannot know what the database
// currently says — so score drift went undetected on 25 of 27 stale reviews.
// These checks are pure comparisons against the live row. They cannot hallucinate
// and they cannot miss.
//
// Every finding names the exact numbers involved, so the reason string is
// actionable rather than "something looks wrong".

// A published page that contradicts our OWN current data is the most serious
// failure mode here: the site is the authority being cited.
const SEVERITY = Object.freeze({ HARD_FAIL: 'hard_fail', WARNING: 'warning' })

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

const { BRAND_STATS, PLATFORM_STAT_PATTERNS } = require('./review-stats')

const toInt = (raw) => {
  const n = Number(String(raw).replace(/[,\s]/g, '').replace(/\.$/, ''))
  return Number.isFinite(n) ? Math.round(n) : null
}

const TOKEN_RE = /\{\{platform_stat:[a-z0-9_]+\}\}/gi

/**
 * @param input {
 *   review: { scam_score, title, full_article, slug, status },
 *   brand:  { scam_score, name },
 * }
 * @returns { ok, findings: [{ code, severity, message }], hardFailReason }
 */
function checkReviewIntegrity(input = {}) {
  const review = input.review && typeof input.review === 'object' ? input.review : {}
  const brand = input.brand && typeof input.brand === 'object' ? input.brand : {}
  const findings = []

  // ── 1. The review's own score vs the brand's current score ────────────────
  // These are the same fact stored twice. If they disagree, the page states a
  // threat level our own data contradicts.
  if (isNum(review.scam_score) && isNum(brand.scam_score) && review.scam_score !== brand.scam_score) {
    findings.push({
      code: 'score_drift',
      severity: SEVERITY.HARD_FAIL,
      message: `Review scam_score (${review.scam_score}) contradicts the brand's current score (${brand.scam_score}). The published page asserts a threat level our own data no longer supports.`,
    })
  }

  // ── 2. A score frozen into the title ──────────────────────────────────────
  // Titles like "Is X a Scam? 90/100 Threat Score [2026]" are the most visible
  // surface and the least likely to be re-checked by a human.
  const titleScore = String(review.title || '').match(/(\d{1,3})\s*\/\s*100/)
  if (titleScore && isNum(brand.scam_score)) {
    const inTitle = Number(titleScore[1])
    if (inTitle !== brand.scam_score) {
      findings.push({
        code: 'title_score_drift',
        severity: SEVERITY.HARD_FAIL,
        message: `Title states ${inTitle}/100 but the brand's current score is ${brand.scam_score}/100. This is the headline users and search engines see.`,
      })
    }
  }

  // ── 3. Per-brand stats hard-coded instead of tokenised ────────────────────
  // The scraper keeps these current on the brand row. A literal in prose cannot
  // track it, so compare what the article claims against what we actually hold.
  const article = typeof review.full_article === 'string' ? review.full_article : ''
  if (article) {
    for (const { field, token, label, detectRe: re } of BRAND_STATS) {
      const actual = brand[field]
      re.lastIndex = 0
      let m
      const seen = new Set()
      while ((m = re.exec(article)) !== null) {
        const claimed = toInt(m[1])
        if (claimed === null || seen.has(claimed)) continue
        seen.add(claimed)
        if (isNum(actual) && claimed !== actual) {
          findings.push({
            code: 'brand_stat_drift',
            severity: SEVERITY.HARD_FAIL,
            message: `Article states ${m[1]} ${label} but the brand's current ${field} is ${actual}. Use ${token} so it resolves live instead of freezing.`,
          })
        } else if (isNum(actual)) {
          findings.push({
            code: 'brand_stat_literal',
            severity: SEVERITY.WARNING,
            message: `${m[1]} ${label} matches the brand's current ${field} today, but it is a literal and will drift. Use ${token}.`,
          })
        }
      }
    }

    // Platform-scale figures need the platform token.
    const platformLiterals = []
    for (const { detectRe: re, label } of PLATFORM_STAT_PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(article)) !== null) {
        platformLiterals.push(`${m[1]} ${label}`)
        if (platformLiterals.length > 8) break
      }
    }
    if (platformLiterals.length > 0) {
      findings.push({
        code: 'hardcoded_platform_stat',
        severity: SEVERITY.HARD_FAIL,
        message: `Platform-scale figures hard-coded rather than tokenised (${platformLiterals.slice(0, 6).join('; ')}). Use {{platform_stat:…}} so they resolve on every sync.`,
      })
    }
  }

  const hardFails = findings.filter((f) => f.severity === SEVERITY.HARD_FAIL)
  return {
    ok: hardFails.length === 0,
    findings,
    hardFailReason: hardFails.length
      ? `Deterministic integrity checks failed: ${hardFails.map((f) => f.message).join(' | ')}`
      : null,
  }
}

module.exports = { SEVERITY, checkReviewIntegrity }
