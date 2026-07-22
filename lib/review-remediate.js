'use strict'

// Deterministic remediation pass for a freshly-generated review.
//
// Runs AFTER generation, BEFORE the publish audit. It fixes only what can be fixed
// with PROVABLE correctness, so the audit veto is reserved for issues that genuinely
// need a human (prose fabrication woven into a sentence, missing sources). It never
// fabricates and never guesses.
//
// Two safe fixes:
//   1. Stat literals → tokens, VALUE-ANCHORED. A number is replaced with its
//      {{stat:KEY}} token ONLY when it equals the brand's current value for that
//      stat. This is what makes prose tokenisation safe here (unlike a blind
//      backfill): at generation time there is no drift, so a literal equal to the
//      live value provably IS that stat. A platform figure ("90+ countries" while
//      this brand targets 49) does not match and is left untouched.
//   2. Fabricated roster names → dropped from the STRUCTURED item_list. A celebrity
//      whose name is not in the ground-truth list was not observed in this brand's
//      ads; in structured data it is safe to remove (prose names are NOT touched —
//      you cannot strip a name from a sentence without risk; the audit catches those).

const { BRAND_STATS } = require('./review-stats')

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// Normalise a value for equality: strip thousands separators / a trailing '+'.
const literalToInt = (raw) => {
  const n = Number(String(raw).replace(/[,\s+]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : null
}

// Which brand field each stat matches its literal against. `ad_creatives`,
// `countries_targeted`, `weekly_velocity` map straight to the brand row.
// `celebrities_abused` matches the DEDUPED count (what the token resolves to),
// NOT the raw total_celebrities.
function statTargets({ total_creatives, total_geos, velocity_7d, celeb_count }) {
  return {
    total_creatives: isNum(total_creatives) ? total_creatives : null,
    total_geos: isNum(total_geos) ? total_geos : null,
    weekly_velocity: isNum(velocity_7d) ? velocity_7d : null,
    // celeb_count is the deduped roster length; {{stat:celebrities_abused}} resolves to it.
    total_celebrities: isNum(celeb_count) ? celeb_count : null,
  }
}

// Map each BRAND_STATS entry to the target value it must equal to be tokenised.
const STAT_FIELD_FOR_TOKEN = {
  '{{stat:ad_creatives}}': 'total_creatives',
  '{{stat:countries_targeted}}': 'total_geos',
  '{{stat:celebrities_abused}}': 'total_celebrities',
}
const VELOCITY_STAT = { token: '{{stat:weekly_velocity}}', field: 'weekly_velocity', re: /([\d][\d,]*)(\s*\+)?(\s*(?:new\s+)?creatives(?:\s+per\s+7\s+days| in the (?:last|past) 7 days)?)/gi }

/**
 * Value-anchored tokenisation of stat literals in a text field.
 * @returns { text, changes: [{ field, from, token }] }
 */
function remediateStatLiterals(text, brandValues, fieldName = 'text') {
  if (typeof text !== 'string' || text === '') return { text: text || '', changes: [] }
  const targets = statTargets(brandValues || {})
  const changes = []
  let out = text

  for (const stat of BRAND_STATS) {
    const brandField = STAT_FIELD_FOR_TOKEN[stat.token]
    const target = targets[brandField]
    if (!isNum(target)) continue // no known value → never tokenise (never guess)
    stat.replaceRe.lastIndex = 0
    out = out.replace(stat.replaceRe, (full, num, plus, noun) => {
      if (full.includes('{{')) return full
      if (literalToInt(`${num}${plus || ''}`) !== target) return full // value must match this brand's stat
      changes.push({ field: fieldName, from: `${num}${plus || ''}`.trim(), token: stat.token })
      return `${stat.token}${noun}`
    })
  }
  return { text: out, changes }
}

// Apply stat remediation across every string leaf of a value (prose fields are
// sometimes arrays/objects — red_flags[], faq[], funnel_stages[]).
function remediateDeep(value, brandValues, fieldName, changes, depth = 0) {
  if (depth > 8) return value
  if (typeof value === 'string') {
    const r = remediateStatLiterals(value, brandValues, fieldName)
    changes.push(...r.changes)
    return r.text
  }
  if (Array.isArray(value)) return value.map((v) => remediateDeep(v, brandValues, fieldName, changes, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = remediateDeep(value[k], brandValues, fieldName, changes, depth + 1)
    return out
  }
  return value
}

// ── incomplete-FAQ pruning (guards against truncated JSON-LD) ───────────────
//
// Generation can hit maxTokens and truncate; the JSON-repair closes the
// structure but the last FAQ answer is cut mid-sentence. That malformed
// `acceptedAnswer` then ships into FAQPage JSON-LD. A finished answer in this
// pipeline is always a full declaration ("40-60 words, declaration-first"), so
// it ends in terminal punctuation. An answer that does not is truncated (or a
// stub) and must not become a rich result — drop the whole Q&A. Better one
// fewer FAQ than a broken FAQPage. Never edits text; only drops whole items.

// A complete answer ends in sentence-terminal punctuation, allowing a trailing
// closing quote/paren/bracket after it.
const COMPLETE_ANSWER_RE = /[.!?…]["'”’)\]]*\s*$/

function isCompleteFaq(item) {
  if (!item || typeof item !== 'object') return false
  const q = typeof item.question === 'string' ? item.question.trim() : ''
  const a = typeof item.answer === 'string' ? item.answer.trim() : ''
  if (q === '' || a === '') return false
  // JSON emits question before answer, so a complete answer implies a complete
  // question — gate on the answer being a finished sentence.
  return COMPLETE_ANSWER_RE.test(a)
}

/**
 * Drop FAQ entries whose answer is empty or truncated (no terminal punctuation).
 * @returns { faq, dropped: [question] }
 */
function pruneIncompleteFaqs(faq) {
  if (!Array.isArray(faq)) return { faq, dropped: [] }
  const dropped = []
  const kept = faq.filter((item) => {
    const ok = isCompleteFaq(item)
    if (!ok) dropped.push(item && typeof item === 'object' ? item.question : String(item))
    return ok
  })
  return { faq: kept, dropped }
}

// Case/space/diacritic-insensitive key for name matching.
function nameKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Drop item_list roster entries whose name is not in the ground-truth list.
 * Structured data only — never touches prose. numberOfItems is recomputed.
 * @returns { itemList, dropped: [names] }
 */
function filterRosterToGroundTruth(itemList, groundTruthNames) {
  const truth = new Set((Array.isArray(groundTruthNames) ? groundTruthNames : []).map(nameKey).filter(Boolean))
  if (!itemList || typeof itemList !== 'object' || !Array.isArray(itemList.items)) {
    return { itemList, dropped: [] }
  }
  if (truth.size === 0) return { itemList, dropped: [] } // no ground truth → don't touch (never guess)

  const dropped = []
  const kept = itemList.items.filter((it) => {
    const ok = it && typeof it === 'object' && truth.has(nameKey(it.name))
    if (!ok && it) dropped.push(it.name)
    return ok
  }).map((it, i) => ({ ...it, position: i + 1 }))

  return {
    itemList: { ...itemList, items: kept, numberOfItems: kept.length },
    dropped,
  }
}

/**
 * Remediate a whole generated review payload in place-safe fashion.
 *
 * @param review    generated content — { full_article, how_it_works, summary,
 *                  red_flags, faq, funnel_stages, verdict, meta_description,
 *                  key_takeaways, item_list, ... }
 * @param context   { brand, groundTruthNames } — brand row + deduped celeb list
 * @returns { review, report: { tokenized: [...], roster_dropped: [...] } }
 */
function remediateReview(review, context = {}) {
  const r = review && typeof review === 'object' ? { ...review } : {}
  const brand = context.brand || {}
  const brandValues = {
    total_creatives: brand.total_creatives,
    total_geos: brand.total_geos,
    velocity_7d: brand.velocity_7d,
    celeb_count: Array.isArray(context.groundTruthNames) ? context.groundTruthNames.length : undefined,
  }

  const tokenized = []
  // Every free-text / structured-text field that can carry a stat literal.
  const TEXT_FIELDS = [
    'full_article', 'how_it_works', 'summary', 'verdict', 'meta_description',
    'red_flags', 'faq', 'funnel_stages', 'key_takeaways', 'not_for_you',
    'protection_steps', 'information_gain_summary', 'headline',
  ]
  for (const f of TEXT_FIELDS) {
    if (r[f] === undefined || r[f] === null) continue
    r[f] = remediateDeep(r[f], brandValues, f, tokenized)
  }

  let rosterDropped = []
  if (r.item_list !== undefined) {
    const { itemList, dropped } = filterRosterToGroundTruth(r.item_list, context.groundTruthNames)
    r.item_list = itemList
    rosterDropped = dropped
  }

  // Drop truncated/empty FAQ answers before they reach FAQPage JSON-LD + HTML.
  let faqDropped = []
  if (r.faq !== undefined) {
    const { faq, dropped } = pruneIncompleteFaqs(r.faq)
    r.faq = faq
    faqDropped = dropped
  }

  return { review: r, report: { tokenized, roster_dropped: rosterDropped, faq_dropped: faqDropped } }
}

module.exports = {
  remediateStatLiterals,
  filterRosterToGroundTruth,
  pruneIncompleteFaqs,
  remediateReview,
  nameKey,
}
