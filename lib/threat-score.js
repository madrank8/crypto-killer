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
 * Known non-Latin → Latin name-pair map. Covers the subset we see in
 * SpyOwl's creative pool: GCC royals, finance officials, Hong Kong
 * public figures, Japanese kanji names, etc. Kept small on purpose —
 * full transliteration libraries pull MB of data and misbehave on
 * proper nouns. This is surgical and grows by observation.
 *
 * The Prestara Nexor review (2026-04-23) shipped with celebrity count
 * drift (body said 2, schema said 8, FAQ hallucinated 3 extra names
 * including 盛智文, 陳德霖, 袁詠儀). Root cause: the v2 dedupe stripped
 * all CJK characters in canonicalizeName (regex /[^a-z0-9]+/), so every
 * Chinese-only name collapsed to '' and was silently skipped. "Paul
 * Chan" (Latin) and "陳茂波" (Chinese, same person — HK Financial
 * Secretary) appeared in the raw celebrity_list as TWO separate rows
 * that never deduped, which then leaked into the writer prompt.
 *
 * v3 adds:
 *   (a) a known-pairs table for HK public figures commonly targeted
 *   (b) a CJK-preserving fallback path in canonicalizeName so unknown
 *       CJK names at least dedupe against themselves (same chars →
 *       same key) instead of being dropped
 *
 * Add entries by appending to the map; canonicalizeName() uses
 * longest-match replacement. Names should be normalized already:
 * canonical Latin form (lowercase, single spaces, no honorifics).
 */
const KNOWN_NAME_PAIRS = [
  // ── Arabic (compound/common phrases FIRST — longest-match wins) ──
  ['الشيخ محمد بن عبد الرحمن آل ثاني', 'sheikh mohammed bin abdulrahman al thani'],
  ['محمد بن عبد الرحمن آل ثاني',      'mohammed bin abdulrahman al thani'],
  ['علي بن أحمد الكواري',              'ali bin ahmed al kuwari'],
  ['الوليد بن طلال',                   'alwaleed bin talal'],
  ['ياسر الرميان',                     'yasir al rumayyan'],
  ['يوسف الظاهري',                     'yousef al dhahiri'],
  ['حسين سجواني',                      'hussein sajwani'],
  ['محمد الكواري',                     'mohammed al kuwari'],

  // ── Japanese kanji ──
  ['黒田東彦', 'haruhiko kuroda'],

  // ── Traditional Chinese (HK public figures commonly impersonated
  //    in crypto scam creatives — source: SpyOwl ad data) ──
  ['陳茂波',   'paul chan'],          // HK Financial Secretary
  ['羅家聰',   'law ka chung'],       // HK economic commentator
  ['余偉文',   'eddie yue'],          // HKMA CEO
  ['陳德霖',   'norman chan'],        // Former HKMA CEO
  ['盛智文',   'allan zeman'],        // Ocean Park chairman
  ['林鄭月娥', 'carrie lam'],         // Former HK Chief Executive
  ['李家超',   'john lee'],           // HK Chief Executive
  ['陳家強',   'k c chan'],           // Former Secretary for Financial Services
  // HK entertainment figures (used in fake celeb-endorsement ads)
  ['王祖藍',   'wong cho lam'],       // Actor
  ['張智霖',   'julian cheung'],      // Actor
  ['曾寶儀',   'bowie tsang'],        // TV host
  ['羅子溢',   'ruco chan'],          // Actor
  ['袁詠儀',   'anita yuen'],         // Actress
  ['郭思嘉',   'cass kwok'],          // HK news figure
  ['邱標',     'yau piu'],            // HK public figure

  // Add Korean / Thai / Hindi / Cyrillic pairs as observed.
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
 * Transliterate any non-Latin script sequences in the input using the
 * KNOWN_NAME_PAIRS table. Longest keys first so multi-word compound
 * names match as a whole rather than piece by piece.
 */
function transliterateKnownPairs(s) {
  if (!s) return s
  let out = s
  // Sort by length desc so longest match wins
  const sorted = [...KNOWN_NAME_PAIRS].sort((a, b) => b[0].length - a[0].length)
  for (const [source, target] of sorted) {
    if (out.includes(source)) out = out.split(source).join(target)
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

  // 1. Known-pair transliteration (Arabic, CJK, others — see KNOWN_NAME_PAIRS)
  s = transliterateKnownPairs(s)

  // 2. Lowercase + NFKD decomposition + strip combining marks (diacritics)
  s = s.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

  // 3. If the result contains Latin letters, take the Latin path:
  //    strip punctuation/non-latin → single space, strip honorifics.
  if (/[a-z0-9]/.test(s)) {
    s = s.replace(/[^a-z0-9]+/g, ' ').trim()
    if (!s) return ''
    const HON_SET = new Set(HONORIFICS.flatMap((h) => h.split(' ')))
    const tokens = s.split(' ').filter((t) => t && !HON_SET.has(t))
    return tokens.join(' ')
  }

  // 4. No Latin letters → non-Latin script (CJK, Arabic we didn't map,
  //    Cyrillic, etc.). Collapse whitespace + CJK/FW punctuation so
  //    "陳茂波" and "陳 茂 波" dedupe. Return the normalized script form
  //    as the key so at least same-script duplicates collapse.
  //    (Cross-script matches still require a KNOWN_NAME_PAIRS entry.)
  return s
    .replace(/[\u3000-\u303F\uFF00-\uFFEF]/g, '') // CJK punctuation, full-width
    .replace(/\s+/g, '')
    .trim()
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
