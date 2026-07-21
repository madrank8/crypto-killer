'use strict'

// One-time backfill transform: rewrite hard-coded per-brand stat literals in a
// published review into {{stat:KEY}} tokens so they self-heal on every sync,
// instead of freezing at generation time.
//
// SAFETY IS THE WHOLE POINT. This edits the body of live YMYL pages, so it is
// deliberately conservative:
//   - It only ever replaces the NUMBER; the noun and surrounding prose are kept
//     byte-for-byte.
//   - It only tokenizes a stat the brand row actually has a value for — never
//     introduces a token we cannot back with data.
//   - The threat SCORE has no per-brand token, so it is corrected to the current
//     value as a one-time literal fix (the integrity checker catches future drift).
//   - Every change is reported, so a dry run shows exactly what would change.
//
// A regex that mangles a sentence is worse than a stale number, so the patterns
// require the stat noun immediately after the digits (see lib/review-stats.js).
//
// ⚠️ PROVEN LIMITATION — do NOT run `tokenizeBrandStats` on free review prose in
// bulk. A dry run against real articles found the SAME noun used for two different
// referents: "45 countries" is this brand's geo count (→ token), but "12 ad
// networks across 90+ countries" is the PLATFORM's scanning reach (must stay a
// literal). Value can't disambiguate either — quantum-ai's "56 celebrities" is a
// legitimately-drifted brand stat now at 353, the same magnitude of difference as
// the platform figure. So blind tokenisation would corrupt correct sentences.
// The correct way to token-ise existing prose is to REGENERATE it through the
// (fixed) writer, which emits the right token by construction. `tokenizeBrandStats`
// is safe only where the caller KNOWS a given number is this brand's stat.
//
// `correctScoreLiterals` has NO such ambiguity (an "N/100" equal to the review's
// own old score is unambiguously its threat score) and was the basis for the
// one-time score backfill applied to the 30 published reviews.

const { BRAND_STATS } = require('./review-stats')

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Replace per-brand stat literals with their tokens.
 * @returns { text, replacements: [{ field, from, token, current }] }
 */
function tokenizeBrandStats(article, brand) {
  if (typeof article !== 'string' || article === '') return { text: article || '', replacements: [] }
  const b = brand && typeof brand === 'object' ? brand : {}
  let text = article
  const replacements = []

  for (const stat of BRAND_STATS) {
    // Never introduce a token we cannot back with real data.
    if (!isNum(b[stat.field])) continue
    stat.replaceRe.lastIndex = 0
    text = text.replace(stat.replaceRe, (full, num, plus, noun) => {
      // Already a token (no digits) can't reach here; guard anyway.
      if (full.includes('{{')) return full
      replacements.push({
        field: stat.field,
        from: `${num}${plus || ''}`.trim(),
        token: stat.token,
        current: b[stat.field],
      })
      return `${stat.token}${noun}`
    })
  }
  return { text, replacements }
}

/**
 * Correct threat-score literals of the form "<oldScore>/100" to the current brand
 * score. Precise by construction: it only touches occurrences that match the OLD
 * review score, which in a scam review is unambiguously the threat score — it will
 * not disturb an unrelated "/100" (e.g. a different rating scale).
 * @returns { text, count }
 */
function correctScoreLiterals(text, oldScore, newScore) {
  if (typeof text !== 'string' || !isNum(oldScore) || !isNum(newScore) || oldScore === newScore) {
    return { text: typeof text === 'string' ? text : '', count: 0 }
  }
  let count = 0
  // Match "<oldScore> / 100" allowing flexible whitespace around the slash.
  const re = new RegExp(`\\b${oldScore}(\\s*/\\s*100)`, 'g')
  const out = text.replace(re, (full, slash) => { count += 1; return `${newScore}${slash}` })
  return { text: out, count }
}

/**
 * Full per-review backfill plan. Pure: computes the new field values and a change
 * report WITHOUT touching any store, so a caller can dry-run and present it first.
 *
 * @returns {
 *   changed,                       // anything to write?
 *   patch: { full_article?, title?, scam_score? },  // only fields that changed
 *   report: { tokenized:[…], score_corrections:{title,body}, score_column },
 * }
 */
function planReviewBackfill(review, brand) {
  const r = review && typeof review === 'object' ? review : {}
  const b = brand && typeof brand === 'object' ? brand : {}
  const patch = {}
  const report = { tokenized: [], score_corrections: { title: 0, body: 0 }, score_column: null }

  // 1. Tokenize per-brand stat literals in the body.
  let body = typeof r.full_article === 'string' ? r.full_article : null
  if (body != null) {
    const { text, replacements } = tokenizeBrandStats(body, b)
    if (replacements.length) report.tokenized = replacements
    body = text
  }

  // 2. Correct threat-score literals in the body (no token exists for the score).
  if (body != null && isNum(r.scam_score) && isNum(b.scam_score)) {
    const { text, count } = correctScoreLiterals(body, r.scam_score, b.scam_score)
    report.score_corrections.body = count
    body = text
  }
  if (body != null && body !== r.full_article) patch.full_article = body

  // 3. Correct the score literal frozen into the title.
  if (typeof r.title === 'string' && isNum(r.scam_score) && isNum(b.scam_score)) {
    const { text, count } = correctScoreLiterals(r.title, r.scam_score, b.scam_score)
    if (count > 0 && text !== r.title) { patch.title = text; report.score_corrections.title = count }
  }

  // 4. The scam_score column itself — the same fact stored twice.
  if (isNum(r.scam_score) && isNum(b.scam_score) && r.scam_score !== b.scam_score) {
    patch.scam_score = b.scam_score
    report.score_column = { from: r.scam_score, to: b.scam_score }
  }

  return { changed: Object.keys(patch).length > 0, patch, report }
}

module.exports = { tokenizeBrandStats, correctScoreLiterals, planReviewBackfill }
