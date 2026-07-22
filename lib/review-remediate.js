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
//   • HIGH-PRECISION — an item is dropped only when it (a) carries an
//     impersonation/endorsement trigger AND (b) names a Latin-script First-Last
//     person who is neither roster-backed nor a role/org/geo word.
//   • LATIN-SCRIPT ONLY — the roster is Latin, so non-Latin transliterations
//     (e.g. "Ίλον Μασκ") cannot be adjudicated and are left alone (a bullet
//     naming Musk/Gates in Greek script is kept). Body prose (full_article) is
//     never edited — the audit veto remains its backstop.

// Trigger words that mark an item as making an impersonation/endorsement claim.
// Without one of these an item is not scanned for dropping (guards org-heavy
// but impersonation-free items like an FCA-registration FAQ).
const IMPERSONATION_TRIGGER_RE = /\b(impersonat|deepfake|endorse|celebrit|likeness|posing|ambassador|spokesperson|figure|face|personalit)\w*/i

// Latin capitalised token → a name candidate is 2–4 of these in a row.
const NAME_SEQ_RE = /[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿĀ-ſ.'’-]+(?:\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿĀ-ſ.'’-]+){1,3}/g

// Capitalised tokens that are NOT person names (role / org / geo / domain).
// Only consulted for a candidate that is NOT roster-backed, so it merely stops
// an org phrase ("Financial Ombudsman Service") from reading as a fabricated
// person — it never overrides a real roster match.
const NON_PERSON_TOKENS = new Set([
  'finance', 'minister', 'financial', 'ombudsman', 'service', 'services',
  'compensation', 'scheme', 'warning', 'list', 'register', 'registration',
  'authority', 'commission', 'bank', 'fund', 'standards', 'trading', 'exchange',
  'europe', 'european', 'asia', 'pacific', 'americas', 'america', 'middle',
  'east', 'west', 'north', 'south', 'union', 'kingdom', 'united', 'states',
  'republic', 'greek', 'english', 'spanish', 'german', 'french', 'italian',
  'portuguese', 'japanese', 'chinese', 'arabic', 'sec', 'fca', 'asic', 'cysec',
  'finma', 'ftc', 'ic3', 'scamsmart', 'ombudsman', 'wayback', 'meta', 'google',
  'tiktok', 'youtube', 'facebook', 'instagram',
])

// nameKey windows of size 2 and 3 within a candidate's tokens.
function nameWindows(tokens) {
  const out = []
  for (let size = 2; size <= 3; size++) {
    for (let i = 0; i + size <= tokens.length; i++) {
      out.push(nameKey(tokens.slice(i, i + size).join(' ')))
    }
  }
  // Also the full candidate (covers exact 2-token names).
  out.push(nameKey(tokens.join(' ')))
  return out
}

/**
 * Find off-roster person names asserted in an impersonation-context text.
 * @returns string[] of offending candidate names (empty if none / no trigger).
 */
function findOffRosterNames(text, rosterSet, extraNonPerson) {
  if (typeof text !== 'string' || text === '') return []
  if (!(rosterSet instanceof Set) || rosterSet.size === 0) return [] // never guess
  if (!IMPERSONATION_TRIGGER_RE.test(text)) return []

  const stop = extraNonPerson instanceof Set ? extraNonPerson : new Set()
  const offenders = []
  const seen = new Set()
  const matches = text.match(NAME_SEQ_RE) || []
  for (const cand of matches) {
    const tokens = cand.split(/\s+/).filter(Boolean)
    if (tokens.length < 2) continue
    // Roster-backed via any 2/3-word window (handles titles: "Finance Minister
    // Nirmala Sitharaman" is backed by the "Nirmala Sitharaman" window).
    if (nameWindows(tokens).some((w) => rosterSet.has(w))) continue
    // Not backed — is it a plausible PERSON name, or a role/org phrase?
    const keys = tokens.map(nameKey)
    if (keys.some((k) => NON_PERSON_TOKENS.has(k) || stop.has(k))) continue
    const key = nameKey(cand)
    if (seen.has(key)) continue
    seen.add(key)
    offenders.push(cand)
  }
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
    const { faq, dropped } = pruneIncompleteFaqs(r.faq)
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
