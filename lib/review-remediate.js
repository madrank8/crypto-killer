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

function hasQandA(item) {
  return item && typeof item === 'object'
    && typeof item.question === 'string' && item.question.trim() !== ''
    && typeof item.answer === 'string' && item.answer.trim() !== ''
}

// Would this answer look truncated (cut mid-sentence)? Only consulted for the
// TAIL of a generation we already know hit max_tokens. A finished answer in this
// pipeline ends in terminal punctuation, but several legitimate non-punctuation
// endings must NOT read as truncated: a URL, a closing bracket/quote/percent, a
// digit (year/count), or an emoji.
function looksTruncated(answer) {
  const s = typeof answer === 'string' ? answer.trim() : ''
  if (s === '') return true
  if (COMPLETE_ANSWER_RE.test(s)) return false
  if (/https?:\/\/\S+$/.test(s)) return false            // ends in a URL
  if (/[)\]"'”’%]$/.test(s)) return false                // closing bracket/quote/percent
  if (/\d$/.test(s)) return false                        // ends in a digit
  if (/\p{Extended_Pictographic}$/u.test(s)) return false // ends in an emoji
  return true
}

/**
 * Drop FAQ entries that cannot ship a clean FAQPage rich result:
 *   • ALWAYS: an item missing a question or an answer (unambiguous).
 *   • WHEN the generation truncated (opts.truncated): trailing answers that were
 *     cut mid-sentence — the max_tokens cut lands on the tail, so we only prune
 *     from the end and stop at the first complete answer. A complete answer on a
 *     normal generation is therefore NEVER dropped (fixes the false-positive on
 *     a legitimate answer that ends in a URL / number / no period).
 * @returns { faq, dropped: [question] }
 */
function pruneIncompleteFaqs(faq, opts = {}) {
  if (!Array.isArray(faq)) return { faq, dropped: [] }
  const dropped = []
  let kept = faq.filter((item) => {
    if (hasQandA(item)) return true
    dropped.push(item && typeof item === 'object' ? item.question : String(item))
    return false
  })
  if (opts.truncated) {
    while (kept.length && looksTruncated(kept[kept.length - 1].answer)) {
      dropped.push(kept[kept.length - 1].question)
      kept = kept.slice(0, -1)
    }
  }
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

// ── off-roster impersonation guard (deterministic, roster-anchored) ─────────
//
// The writer sometimes names a real public figure as an impersonation target
// who is NOT in this brand's scraped celebrity roster (e.g. Pauline Hanson,
// Sudha Murthy on a brand whose roster has Musk/Gates/Farage/Sitharaman). That
// is YMYL fabrication. #73 filters the STRUCTURED item_list; this guard covers
// the two item-granular prose fields — experience_signals (bullets) and faq
// (Q&A) — where a contaminated item can be dropped WHOLE without editing a
// sentence.
//
// Design constraints (why it is safe to auto-drop here):
//   • ROSTER-ANCHORED — a name is "fabricated" only when it is provably absent
//     from the ground-truth roster. Never guesses.
//   • CONSTRUCTION-GATED — a name is a violation ONLY when it is grammatically
//     bound to an impersonation cue: it FOLLOWS a cue ("impersonating … like
//     Nigel Farage and Pauline Hanson", "deepfake of X"), or matches the geo
//     construction ("Pauline Hanson for AU"). Mere co-occurrence of a
//     capitalised word with a scam word does NOT qualify — that is what keeps a
//     quoted source ("Action Fraud spokesperson Sarah Jones said…"), an org
//     phrase ("Government Officials"), or a city ("New York regulators…") from
//     being mistaken for a fabricated impersonation victim.
//   • LATIN-SCRIPT ONLY / 2+ TOKENS — the roster is Latin, so non-Latin
//     transliterations ("Ίλον Μασκ") are left alone; a lone surname is never
//     flagged (single-token detection would misfire on every capitalised word).
//   • Precision over recall: constructions this cannot parse (a name-list after
//     a non-cue verb, active-voice "X was endorsing", a bare surname) are left
//     to the audit veto. A false negative regenerates; a false-positive DROP
//     would silently delete correct YMYL content, so precision wins.
//   • Body prose (full_article) is never edited.

// A person-name atom: 2–4 Latin capitalised tokens (diacritics, apostrophes,
// hyphens allowed). No '.' in the continuation class — that previously joined a
// sentence-final "No." to the next sentence's first word.
const NAME_ATOM_SRC = "[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿĀ-ſ'’-]+(?:\\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿĀ-ſ'’-]+){1,3}"
const NAME_ATOM_RE = new RegExp(NAME_ATOM_SRC, 'g')

// Impersonation CUES. The name(s) must FOLLOW the cue, within the same clause
// (capture stops at the next sentence terminator). Verb roots are written
// without a trailing vowel so \w* covers -ing/-ed/-es (endorsing, deepfaking).
const CUE_RE = new RegExp(
  '(?:' +
    'impersonat\\w+|deepfak\\w+|clon\\w+|masquerad\\w+\\s+as|pos\\w+\\s+as|' +
    'likeness\\s+of|image\\s+of|face\\s+of|voice\\s+of|portray\\w+\\s+(?:as\\s+)?|' +
    'endors\\w+\\s+(?:by|from)|featuring|starring|' +
    '(?:figures?|celebrit\\w+|faces?|personalit\\w+|people|names?)\\s+(?:like|such\\s+as|including)' +
  ')\\s+([^.!?]{0,90})',
  'gi',
)

// Geo-pairing construction: "<Name> for GB", "<Name> for AU" (2-letter country
// code) — the writer's geo-targeting phrasing that pairs a face to a market.
const GEO_PAIR_RE = new RegExp('(' + NAME_ATOM_SRC + ')\\s+for\\s+(?:the\\s+)?[A-Z]{2}\\b', 'g')

// Capitalised tokens that are NOT person names (role / org / geo / domain).
// Secondary guard inside a construction (e.g. "deepfake of the Financial
// Ombudsman Service"); never overrides a real roster match.
const NON_PERSON_TOKENS = new Set([
  'finance', 'minister', 'financial', 'ombudsman', 'service', 'services',
  'compensation', 'scheme', 'warning', 'list', 'register', 'registration',
  'authority', 'commission', 'bank', 'fund', 'standards', 'trading', 'exchange',
  'government', 'officials', 'official', 'regulators', 'regulator', 'police',
  'europe', 'european', 'asia', 'pacific', 'americas', 'america', 'middle',
  'east', 'west', 'north', 'south', 'union', 'kingdom', 'united', 'states',
  'republic', 'greek', 'english', 'spanish', 'german', 'french', 'italian',
  'portuguese', 'japanese', 'chinese', 'arabic', 'new', 'york', 'london',
  'hong', 'kong', 'los', 'angeles', 'sec', 'fca', 'asic', 'cysec', 'finma',
  'ftc', 'ic3', 'scamsmart', 'wayback', 'meta', 'google', 'tiktok', 'youtube',
  'facebook', 'instagram', 'action', 'fraud',
])

// nameKey windows of size 2 and 3 within a candidate's tokens (title-tolerant:
// "Finance Minister Nirmala Sitharaman" is backed by the "Nirmala Sitharaman"
// window).
function nameWindows(tokens) {
  const out = []
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i + size <= tokens.length; i++) {
      out.push(nameKey(tokens.slice(i, i + size).join(' ')))
    }
  }
  out.push(nameKey(tokens.join(' ')))
  return out
}

/**
 * Find off-roster person names asserted, in an impersonation CONSTRUCTION, in
 * the given text. Only names grammatically bound to an impersonation cue are
 * considered — see the block comment above for why.
 * @returns string[] of offending candidate names (empty if none).
 */
function findOffRosterNames(text, rosterSet, extraNonPerson) {
  if (typeof text !== 'string' || text === '') return []
  if (!(rosterSet instanceof Set) || rosterSet.size === 0) return [] // never guess

  const stop = extraNonPerson instanceof Set ? extraNonPerson : new Set()
  const offenders = []
  const seen = new Set()

  const consider = (cand) => {
    const tokens = String(cand).trim().split(/\s+/).filter(Boolean)
    if (tokens.length < 2) return // never flag a lone token
    if (nameWindows(tokens).some((w) => rosterSet.has(w))) return // roster-backed
    const keys = tokens.map(nameKey)
    if (keys.some((k) => NON_PERSON_TOKENS.has(k) || stop.has(k))) return // org/geo/role
    const key = nameKey(cand)
    if (seen.has(key)) return
    seen.add(key)
    offenders.push(String(cand).trim())
  }

  // Names FOLLOWING an impersonation cue (handles lists: "X, Y and Z").
  let m
  CUE_RE.lastIndex = 0
  while ((m = CUE_RE.exec(text)) !== null) {
    const region = m[1] || ''
    for (const name of region.match(NAME_ATOM_RE) || []) consider(name)
  }
  // "<Name> for <CC>" geo-pairing.
  GEO_PAIR_RE.lastIndex = 0
  while ((m = GEO_PAIR_RE.exec(text)) !== null) consider(m[1])

  return offenders
}

/**
 * Drop experience_signals bullets and faq items that assert an off-roster
 * impersonation. Roster-anchored; scans faq question+answer together.
 * @returns { experience_signals, faq, dropped: [{field, text, names}] }
 */
function dropOffRosterImpersonation(review, groundTruthNames, brandName) {
  const rosterSet = new Set(
    (Array.isArray(groundTruthNames) ? groundTruthNames : []).map(nameKey).filter(Boolean),
  )
  // Brand-name tokens are never impersonation victims — exclude them.
  const brandStop = new Set(
    String(brandName || '').split(/\s+/).map(nameKey).filter(Boolean),
  )
  const dropped = []
  const out = {}

  if (Array.isArray(review.experience_signals)) {
    out.experience_signals = review.experience_signals.filter((sig) => {
      const names = findOffRosterNames(typeof sig === 'string' ? sig : '', rosterSet, brandStop)
      if (names.length) dropped.push({ field: 'experience_signals', text: sig, names })
      return names.length === 0
    })
  }
  if (Array.isArray(review.faq)) {
    out.faq = review.faq.filter((item) => {
      const text = item && typeof item === 'object'
        ? `${item.question || ''} ${item.answer || ''}`
        : ''
      const names = findOffRosterNames(text, rosterSet, brandStop)
      if (names.length) dropped.push({ field: 'faq', text: item?.question, names })
      return names.length === 0
    })
  }
  return { experience_signals: out.experience_signals, faq: out.faq, dropped }
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
    const { faq, dropped } = pruneIncompleteFaqs(r.faq, { truncated: !!context.truncated })
    r.faq = faq
    faqDropped = dropped
  }

  // Drop experience_signals / faq items that assert an off-roster impersonation
  // (roster-anchored; body prose stays for the audit veto).
  const impersonation = dropOffRosterImpersonation(r, context.groundTruthNames, brand.name)
  if (impersonation.experience_signals !== undefined) r.experience_signals = impersonation.experience_signals
  if (impersonation.faq !== undefined) r.faq = impersonation.faq

  return {
    review: r,
    report: {
      tokenized,
      roster_dropped: rosterDropped,
      faq_dropped: faqDropped,
      impersonation_dropped: impersonation.dropped,
    },
  }
}

module.exports = {
  remediateStatLiterals,
  filterRosterToGroundTruth,
  pruneIncompleteFaqs,
  findOffRosterNames,
  dropOffRosterImpersonation,
  remediateReview,
  nameKey,
}
