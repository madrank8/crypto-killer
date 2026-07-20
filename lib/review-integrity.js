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

// PLATFORM-scale claims that must be tokens, never literals.
//
// Calibrated against all 30 published reviews rather than assumed. A bare
// "N ad creatives" pattern was REMOVED after it fired on 29/30: per-brand creative
// counts ("we captured 202 creatives for this brand") are legitimate measured
// facts with their own per-review {{stat:ad_creatives}} token, and are indexed
// against the brand's own data — only PLATFORM-wide totals must be tokenised.
// Flagging them would have made this check noise that operators learn to ignore.
//
// Country counts are always flagged: geo_regions is empty, so NO verified
// aggregate backs them. Any figure is unverifiable by construction — this is the
// check that catches quantum-ai's "45 countries" (21/30 published reviews carry one).
const PLATFORM_LITERAL_PATTERNS = [
  { re: /([\d][\d,\.]*)\s*\+?\s*(?:documented\s+|catalogued\s+|investigated\s+)?scam\s+brands/gi, label: 'scam brands' },
  { re: /([\d][\d,\.]*)\s*\+?\s*brands\s+(?:tracked|catalogued|documented)/gi, label: 'brands tracked' },
  { re: /(?:across|in)\s+([\d][\d,\.]*)\s*\+?\s*countries/gi, label: 'countries (no verified aggregate exists)' },
]

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

  // ── 3. Platform aggregates hard-coded instead of tokenised ────────────────
  // A literal freezes at generation time; a {{platform_stat:}} token resolves on
  // every sync. Any platform-scale number written as a digit will go stale.
  const article = typeof review.full_article === 'string' ? review.full_article : ''
  if (article) {
    const tokenCount = (article.match(TOKEN_RE) || []).length
    const literals = []
    for (const { re, label } of PLATFORM_LITERAL_PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(article)) !== null) {
        literals.push(`${m[1]} ${label}`)
        if (literals.length > 12) break
      }
    }
    if (literals.length > 0) {
      findings.push({
        code: 'hardcoded_platform_stat',
        severity: SEVERITY.HARD_FAIL,
        message: `Platform-scale figures are hard-coded rather than tokenised (${literals.slice(0, 6).join('; ')}${literals.length > 6 ? `; +${literals.length - 6} more` : ''}). Literals freeze at generation time; use {{platform_stat:…}} so they resolve live on every sync.`,
      })
    } else if (tokenCount === 0 && /cryptokiller/i.test(article)) {
      // No literals found and no tokens either — the article may simply not cite
      // platform scale. Informational, not a block.
      findings.push({
        code: 'no_platform_tokens',
        severity: SEVERITY.WARNING,
        message: 'Article contains no {{platform_stat:…}} tokens. Fine if it makes no platform-scale claims; worth a look if it should.',
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
