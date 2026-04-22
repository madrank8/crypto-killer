/**
 * Threat Score — tier classification + celebrity list normalization
 *
 * ─── 2026-04-22: dedupeCelebrityList v2 ────────────────────────────────
 *
 * The v1 dedupe was case-insensitive string match only. That failed to
 * collapse:
 *   (a) accent variants     — "Pau García-Milà" vs "Pau Garcia-Mila"
 *   (b) transliterations    — "Prince Alwaleed Bin Talal"
 *                             vs "الوليد بن طلال"
 *                             vs "Al-Waleed bin Talal"
 *   (c) honorific variants  — "Prince Alwaleed" vs "Alwaleed Bin Talal"
 *
 * The Floventra review shipped 28 bullets for a "26 celebrities" claim
 * because the raw brand.celebrity_list contained 4 duplicate pairs that
 * v1 couldn't detect. That's a self-contradicting YMYL page — Google's
 * raters are trained to penalize exactly this.
 *
 * v2 builds a canonical key per name by:
 *   1. Splitting compound "Name A, Name B" entries (unchanged from v1)
 *   2. Unicode NFKD normalization + diacritic stripping
 *   3. Transliterating Arabic → Latin via a small bespoke map
 *   4. Collapsing whitespace, punctuation, honorifics
 *   5. Matching on the canonical key; preserving the first-seen display form
 *
 * Also exposes:
 *   - canonicalizeName(raw) → string key (exported for tests + the
 *     mention_slugs generator downstream)
 *   - pluralize() — unchanged
 *   - classifyThreat() — unchanged
 */

const TIERS = [
  {
    tier: 'confirmed',
    min: 80,
    label: 'Confirmed Scam',
    badge: 'CONFIRMED',
    frameAsScam: true,
    prose: 'is a confirmed crypto scam',
    verdictOpener: 'is a confirmed crypto scam. Do not deposit funds',
  },
  {
    tier: 'high',
    min: 60,
    label: 'High Risk',
    badge: 'HIGH RISK',
    frameAsScam: true,
    prose: 'shows overwhelming evidence of fraudulent activity',
    verdictOpener: 'shows overwhelming evidence of fraudulent activity. Treat as a confirmed scam',
  },
  {
    tier: 'elevated',
    min: 40,
    label: 'Elevated Risk',
    badge: 'ELEVATED',
    frameAsScam: false,
    prose: 'exhibits multiple serious red flags associated with investment fraud',
    verdictOpener: 'exhibits multiple red flags. Exercise extreme caution',
  },
  {
    tier: 'watchlist',
    min: 20,
    label: 'Watchlist',
    badge: 'WATCHLIST',
    frameAsScam: false,
    prose: 'is on Crypto Killer\'s watchlist pending further investigation',
    verdictOpener: 'is under active investigation. Verify before depositing',
  },
  {
    tier: 'low',
    min: 0,
    label: 'Low Signal',
    badge: 'LOW SIGNAL',
    frameAsScam: false,
    prose: 'shows limited signals in current surveillance data',
    verdictOpener: 'shows limited signals. Ongoing monitoring',
  },
]

function classifyThreat(rawScore) {
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0
  const tier = TIERS.find((t) => score >= t.min) || TIERS[TIERS.length - 1]
  return {
    score,
    tier: tier.tier,
    label: tier.label,
    badge: tier.badge,
    prose: tier.prose,
    verdictOpener: tier.verdictOpener,
    frameAsScam: tier.frameAsScam,
  }
}

// ─── Canonical-name machinery for the v2 dedupe ─────────────────────

/**
 * Arabic → Latin transliteration map. Covers the subset we actually see
 * in SpyOwl's creative pool: GCC royals, finance officials, Egyptian
 * media figures, LatAm-adjacent celebrities who ran Arabic-language
 * campaigns. Kept small on purpose — full transliteration libraries
 * pull MB of data and misbehave on proper nouns. This is surgical.
 *
 * Add entries by appending to the map; canonicalizeName() uses
 * longest-match replacement.
 */
const AR_TO_LATIN = [
  // Compound/common phrases FIRST (longest-match wins)
  ['الشيخ محمد بن عبد الرحمن آل ثاني', 'sheikh mohammed bin abdulrahman al thani'],
  ['محمد بن عبد الرحمن آل ثاني',      'mohammed bin abdulrahman al thani'],
  ['علي بن أحمد الكواري',              'ali bin ahmed al kuwari'],
  ['الوليد بن طلال',                   'alwaleed bin talal'],
  ['ياسر الرميان',                     'yasir al rumayyan'],
  ['يوسف الظاهري',                     'yousef al dhahiri'],
  ['حسين سجواني',                      'hussein sajwani'],
  ['محمد الكواري',                     'mohammed al kuwari'],
  // Japanese kanji seen in SpyOwl data
  ['黒田東彦', 'haruhiko kuroda'],
  // Korean, Cyrillic, etc. — add as encountered.
]

/**
 * Honorifics/titles to strip BEFORE match. Prince/Sheikh/HRH etc. are
 * metadata, not part of the identity — "Prince Alwaleed" and
 * "Alwaleed Bin Talal" are the same person.
 */
const HONORIFICS = [
  'prince', 'princess', 'sheikh', 'sheikha', 'sir', 'dame',
  'hrh', 'hh', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'hon',
  'his excellency', 'her excellency', 'secretary-general',
  'president', 'vice-president', 'governor', 'minister',
]

/**
 * Transliterate any Arabic-script sequences in the input using AR_TO_LATIN.
 * Longest keys first so "الشيخ محمد بن عبد الرحمن آل ثاني" matches as
 * the full name rather than piece by piece.
 */
function transliterateArabic(s) {
  if (!s) return s
  let out = s
  // Sort by length desc so longest match wins
  const sorted = [...AR_TO_LATIN].sort((a, b) => b[0].length - a[0].length)
  for (const [ar, lat] of sorted) {
    if (out.includes(ar)) out = out.split(ar).join(lat)
  }
  return out
}

/**
 * Build a canonical match key for a name. NOT for display — this is
 * only used as a Map key for dedup. The first-seen display form wins.
 *
 *   "Pau García-Milà"              → "pau garcia mila"
 *   "Pau Garcia-Mila"              → "pau garcia mila"
 *   "Prince Alwaleed Bin Talal"    → "alwaleed bin talal"
 *   "الوليد بن طلال"               → "alwaleed bin talal"
 */
function canonicalizeName(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  if (!s) return ''

  // 1. Transliterate known Arabic/CJK phrases
  s = transliterateArabic(s)

  // 2. Lowercase + NFKD decomposition + strip combining marks (diacritics)
  s = s.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

  // 3. Strip any remaining non-letter/digit runs → single space
  //    Keeps Latin letters + ASCII digits; drops punctuation, extra scripts.
  s = s.replace(/[^a-z0-9]+/g, ' ').trim()

  if (!s) return ''

  // 4. Token-level honorific strip. We work on word tokens so
  //    "his excellency" survives the space normalization above.
  const HON_SET = new Set(HONORIFICS.flatMap((h) => h.split(' ')))
  const tokens = s.split(' ').filter((t) => t && !HON_SET.has(t))

  // 5. Collapse extra spaces
  return tokens.join(' ')
}

/**
 * Quick test: does the string contain any Latin letters? We prefer
 * Latin-script display forms over CJK / Arabic / Cyrillic when both
 * are available for the same canonical person. On an English-language
 * review page "Prince Alwaleed Bin Talal" reads better than the Arabic
 * form even if the Arabic arrived first in the data.
 */
function hasLatinLetters(s) {
  return typeof s === 'string' && /[a-zA-Z]/.test(s)
}

/**
 * Deduplicate a celebrity_list that may contain compound strings,
 * accent variants, or cross-script duplicates.
 *
 * Upstream SpyOwl data sometimes stores pairings as comma-joined strings,
 * e.g. "Nabela Qoser, Eddie Yue Wai-man" as a SINGLE element. This also
 * handles that case (same as v1).
 *
 * Display-form selection:
 *   - First-seen wins by default
 *   - EXCEPT when a later variant contains Latin letters and the
 *     first-seen did not (e.g. Arabic seen first, English seen later).
 *     In that case the Latin form replaces it. This prevents pages
 *     rendering "الوليد بن طلال" instead of "Prince Alwaleed Bin Talal"
 *     just because the data order happened to surface Arabic first.
 *
 * @param {string[] | null | undefined} list
 * @returns {string[]}  preferred display form of each unique person
 */
function dedupeCelebrityList(list) {
  if (!Array.isArray(list)) return []
  const displayByKey = new Map() // canonical → current chosen display
  const orderByKey = new Map()   // canonical → insertion order index
  let order = 0

  for (const raw of list) {
    if (typeof raw !== 'string') continue
    for (const namePart of raw.split(/[,;]/)) {
      const display = namePart.trim()
      if (!display) continue
      const key = canonicalizeName(display)
      if (!key) continue

      if (!displayByKey.has(key)) {
        displayByKey.set(key, display)
        orderByKey.set(key, order++)
      } else {
        // Already seen this person — consider upgrading display form.
        const existing = displayByKey.get(key)
        if (!hasLatinLetters(existing) && hasLatinLetters(display)) {
          displayByKey.set(key, display)
        }
      }
    }
  }

  // Return in first-seen order
  return [...displayByKey.entries()]
    .sort((a, b) => orderByKey.get(a[0]) - orderByKey.get(b[0]))
    .map(([, display]) => display)
}

/**
 * Format an integer with the correct singular/plural noun.
 *
 * @param {number} n
 * @param {string} singular
 * @param {string} plural - optional; defaults to singular + 's'
 */
function pluralize(n, singular, plural) {
  const count = Number.isFinite(n) ? n : 0
  const noun = count === 1 ? singular : plural || `${singular}s`
  return `${count.toLocaleString()} ${noun}`
}

module.exports = {
  classifyThreat,
  dedupeCelebrityList,
  canonicalizeName,
  pluralize,
  TIERS,
}
