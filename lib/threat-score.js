/**
 * lib/threat-score.js
 *
 * Single source of truth for mapping a raw `scam_score` integer to severity
 * labels, badges, prose framing, and presentational helpers.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 * The SpyOwl-derived `scam_score` is not a 0-100 probability. It's a weighted
 * signal aggregate. Across all 11,240 brands in scam_brands:
 *   min=1, median=1, p90=4, p95=7, p99=15, p99.5=19, p99.9=28, max=89
 *
 * So a brand scoring 13 is in the top 0.5% of the distribution — it is a
 * real, confirmed scam — even though "13/100" looks low to a reader.
 *
 * The old ladder used >=80 for "CONFIRMED SCAM", which matched exactly ONE
 * brand in the entire dataset. The ladder below is calibrated to the real
 * distribution.
 *
 * See audit notes: PR #3 (score-polarity fix).
 *
 * ─── Tiers ─────────────────────────────────────────────────────────────────
 *   score >= 20   confirmed   (top 0.5%)   — "confirmed crypto scam"
 *   score >= 10   high        (top 1%)     — "very high risk"
 *   score >=  5   elevated    (top 5%)     — "high risk"
 *   score >=  2   watchlist   (top ~50%)   — "monitored / verify first"
 *   score <   2   low         (baseline)   — "low signal"
 *
 * `frameAsScam` is TRUE for `confirmed` and `high` — the two tiers where the
 * evidence is strong enough to use declarative scam language in the prose.
 * `elevated` and below use hedged language ("exhibits multiple red flags",
 * "warrants caution") to avoid defamation risk on brands that may be
 * under-researched rather than fraudulent.
 */

const TIERS = [
  {
    tier: 'confirmed',
    minScore: 20,
    label: 'Confirmed Scam — Do Not Deposit',
    shortLabel: 'Confirmed Scam',
    badge: '⚠️ CONFIRMED SCAM',
    prose: 'is a confirmed crypto investment scam',
    verdictOpener: 'is a confirmed crypto scam. Avoid all contact',
    frameAsScam: true,
  },
  {
    tier: 'high',
    minScore: 10,
    label: 'Very High Risk — Avoid All Contact',
    shortLabel: 'Very High Risk',
    badge: '⚠️ VERY HIGH RISK',
    prose: 'shows every hallmark of a crypto investment scam',
    verdictOpener: 'presents overwhelming evidence of fraudulent activity. Do not deposit',
    frameAsScam: true,
  },
  {
    tier: 'elevated',
    minScore: 5,
    label: 'High Risk — Exercise Extreme Caution',
    shortLabel: 'High Risk',
    badge: '⚠️ HIGH RISK',
    prose: 'exhibits multiple serious red flags consistent with investment fraud',
    verdictOpener: 'carries substantial risk. Treat with extreme caution',
    frameAsScam: false,
  },
  {
    tier: 'watchlist',
    minScore: 2,
    label: 'Watchlist — Verify Before Deposit',
    shortLabel: 'Watchlist',
    badge: '⚠️ MONITORED',
    prose: 'appears on Crypto Killer\'s watchlist pending further investigation',
    verdictOpener: 'has not met the evidentiary threshold for a scam designation, but several signals warrant caution',
    frameAsScam: false,
  },
  {
    tier: 'low',
    minScore: 0,
    label: 'Low Signal',
    shortLabel: 'Low Signal',
    badge: 'ℹ️ LOW SIGNAL',
    prose: 'shows limited signals in current surveillance data',
    verdictOpener: 'shows low surveillance signal at this time. Continued monitoring is warranted',
    frameAsScam: false,
  },
]

/**
 * Classify a raw scam_score (0-100 integer) into a tier with labels and prose.
 * Returns a stable object — callers can depend on every field being present.
 *
 * @param {number | null | undefined} score - Raw scam_score from scam_brands.
 * @returns {{
 *   tier: 'confirmed' | 'high' | 'elevated' | 'watchlist' | 'low',
 *   score: number,
 *   label: string,
 *   shortLabel: string,
 *   badge: string,
 *   prose: string,
 *   verdictOpener: string,
 *   frameAsScam: boolean,
 * }}
 */
function classifyThreat(score) {
  const s = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0
  const tier = TIERS.find(t => s >= t.minScore) || TIERS[TIERS.length - 1]
  return {
    tier: tier.tier,
    score: s,
    label: tier.label,
    shortLabel: tier.shortLabel,
    badge: tier.badge,
    prose: tier.prose,
    verdictOpener: tier.verdictOpener,
    frameAsScam: tier.frameAsScam,
  }
}

/**
 * Deduplicate a celebrity_list that may contain compound strings.
 *
 * Upstream SpyOwl data sometimes stores pairings as comma-joined strings,
 * e.g. "Nabela Qoser, Eddie Yue Wai-man" as a SINGLE element instead of two.
 * This helper splits, trims, and dedupes preserving first-seen order.
 *
 * @param {string[] | null | undefined} list
 * @returns {string[]}
 */
function dedupeCelebrityList(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    for (const name of raw.split(/[,;]/)) {
      const clean = name.trim()
      if (!clean) continue
      const key = clean.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(clean)
    }
  }
  return out
}

/**
 * Format an integer with the correct singular/plural noun.
 * Fixes bugs like "1 countries" / "1 celebrities" shipped in early reviews.
 *
 * @param {number} n
 * @param {string} singular
 * @param {string} plural - optional; defaults to singular + 's'
 */
function pluralize(n, singular, plural) {
  const count = Number.isFinite(n) ? n : 0
  const noun = count === 1 ? singular : (plural || `${singular}s`)
  return `${count.toLocaleString()} ${noun}`
}

module.exports = {
  classifyThreat,
  dedupeCelebrityList,
  pluralize,
  TIERS, // exported for tests / admin inspection
}
