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

// ─── Threat classification ────────────────────────────────────────────────
// MOVED (Phase 1, 2026-08-31) to lib/threat-classification.js so there is
// exactly ONE score→language map in the codebase. This file keeps the
// re-exports so every existing import site keeps working unchanged; the
// behaviour change is that `frameAsScam` is now evidence-gated, not
// score-gated. See lib/threat-classification.js for the reasoning.
const {
  BANDS: TIERS,
  classifyThreat,
  brandEvidence,
  normalizeScore,
  evaluateCorroboration,
} = require('./threat-classification')

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

  // ── Cyrillic (transliteration variants from SpyOwl's Eastern European
  //    creative pool — primarily the WhatsApp Bot / similar campaigns
  //    targeting LV/BG/LT/PL/MD/EE markets where the same Latin-name
  //    celebrity appears in both Latin and Cyrillic ad copy)
  //    ─────────────────────────────────────────────────────────────
  // Tech/business figures most commonly impersonated in crypto scams.
  // The 2026-04-28 WhatsApp Bot review had Mark Zuckerberg / Марк
  // Цукерберг counted as 2 distinct celebrities because the v3
  // canonicalize function dropped non-Latin scripts to '' or kept the
  // CJK-style raw script form, never matching the Latin variant.
  ['Марк Цукерберг',     'mark zuckerberg'],          // Mark Zuckerberg, Cyrillic
  ['Илон Маск',          'elon musk'],                // Elon Musk, Russian
  ['Ілон Маск',          'elon musk'],                // Elon Musk, Ukrainian
  ['Джефф Безос',        'jeff bezos'],
  ['Билл Гейтс',         'bill gates'],
  ['Білл Гейтс',         'bill gates'],
  ['Ричард Брэнсон',     'richard branson'],
  ['Уоррен Баффетт',     'warren buffett'],
  ['Тим Кук',            'tim cook'],
  ['Сатья Наделла',      'satya nadella'],
  ['Сергей Брин',        'sergey brin'],
  ['Ларри Пейдж',        'larry page'],
  ['Сэм Альтман',        'sam altman'],
  ['Чанпэн Чжао',        'changpeng zhao'],           // CZ / Binance
  ['Виталик Бутерин',    'vitalik buterin'],
  // SpyOwl-observed Russian-language fabricated personas (these are NOT
  // real public figures — the scam ads invent them — but the rows still
  // need to dedupe against any Latin transliteration the ads also use):
  ['Олег Чертов',         'oleg chertov'],
  ['Александр Иванов',   'aleksandr ivanov'],
  ['Елена Петрова',      'elena petrova'],
  ['Дмитрий Соколов',    'dmitry sokolov'],
  ['Анна Смирнова',      'anna smirnova'],

  // Add Korean / Thai / Hindi pairs as observed.
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
 * Per-category threat sub-scores (audit 2026-07-05, W5c — review-quality-gate
 * L2: "a single overall score with no category breakdown → cap at 45").
 *
 * DETERMINISTIC — computed from measured brand data, never model output, so
 * every number is defensible and reproducible. Banded 0-100 scales chosen to
 * be monotonic and explainable; each score carries its evidence string for
 * the rendered "Ratings at a Glance" block and reviewRating.ratingExplanation.
 *
 * @param {object} brand - scam_brands row
 * @param {number} [dedupedCelebCount] - authoritative celeb count (falls back
 *   to raw total_celebrities)
 * @returns {Array<{key, label, score, evidence}>}
 */
function computeCategoryScores(brand = {}, dedupedCelebCount = null) {
  const band = (v, stops) => {
    // stops: [[threshold, score], ...] ascending; returns score of the last
    // stop whose threshold <= v.
    let s = stops[0][1]
    for (const [t, sc] of stops) if (v >= t) s = sc
    return s
  }
  const celebs = Number.isFinite(dedupedCelebCount) ? dedupedCelebCount : (brand.total_celebrities || 0)
  const geos = brand.total_geos || 0
  const velocity = brand.velocity_7d || 0
  const creatives = brand.total_creatives || 0
  const days = (() => {
    if (!brand.first_seen_at) return 0
    const end = brand.last_seen_at ? new Date(brand.last_seen_at) : new Date()
    return Math.max(0, Math.round((end - new Date(brand.first_seen_at)) / 86400000))
  })()

  return [
    {
      key: 'celebrity_abuse',
      label: 'Celebrity Impersonation',
      score: band(celebs, [[0, 5], [1, 40], [3, 60], [6, 80], [11, 95]]),
      evidence: celebs > 0 ? `{{stat:celebrities_abused}} real people impersonated in ads` : 'no celebrity impersonation detected',
    },
    {
      key: 'geo_spread',
      label: 'Geographic Spread',
      score: band(geos, [[0, 5], [1, 25], [2, 40], [5, 60], [10, 80], [20, 95]]),
      evidence: `ads detected in {{stat:countries_targeted}} countries`,
    },
    {
      key: 'ad_velocity',
      label: 'Campaign Velocity',
      score: band(velocity, [[0, 10], [1, 40], [5, 60], [15, 80], [30, 95]]),
      evidence: `{{stat:weekly_velocity}} new creatives in the last 7 days`,
    },
    {
      key: 'campaign_scale',
      label: 'Campaign Scale',
      score: band(creatives, [[0, 5], [1, 25], [10, 40], [50, 60], [200, 80], [1000, 95]]),
      evidence: `{{stat:ad_creatives}} ad creatives catalogued`,
    },
    {
      key: 'longevity',
      label: 'Operation Longevity',
      score: band(days, [[0, 10], [7, 30], [30, 50], [90, 70], [180, 85], [365, 95]]),
      evidence: `{{stat:days_active}} days between first and last detected activity`,
    },
  ]
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
  brandEvidence,
  normalizeScore,
  evaluateCorroboration,
  computeCategoryScores,
  dedupeCelebrityList,
  canonicalizeName,
  pluralize,
  TIERS,
}
