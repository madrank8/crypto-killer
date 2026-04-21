/**
 * lib/threat-score.js
 *
 * Single source of truth for mapping a raw `scam_score` integer to severity
 * labels, badges, prose framing, and presentational helpers.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 * The SpyOwl-derived `scam_score` is a weighted signal aggregate recalibrated
 * 2026-04-21 to properly span 0-100. Across the 9,331 active brands:
 *   min=6, median=10, p90=24, p95=30, p99=49, max=100
 *
 * Distribution buckets after recalibration (migration
 * `recalibrate_scam_score_formula`):
 *   80-100 Extreme:    0.1%  — only the worst major operations
 *   60-79  High:       0.3%  — large ongoing scam campaigns
 *   40-59  Moderate:   1.7%  — serious red-flag brands
 *   20-39  Low:       14.2%  — modest-scale suspicious brands
 *    0-19  Minimal:   83.8%  — noise / legitimate / micro-scale
 *
 * The ladder below is calibrated to this new distribution so the prose framing
 * stays defamation-safe while the "confirmed scam" language is still strong
 * where the evidence supports it.
 *
 * See audit notes: PR #3 (score-polarity fix), recalibrated after
 * migration `recalibrate_scam_score_formula` landed 2026-04-21.
 *
 * ─── Tiers ─────────────────────────────────────────────────────────────────
 *   score >= 80  confirmed   (~0.1%, 10 brands) — "confirmed crypto scam"
 *   score >= 60  high        (~0.3%, 29 brands) — "shows every hallmark"
 *   score >= 40  elevated    (~1.7%, 154 brands) — "multiple serious red flags"
 *   score >= 20  watchlist   (~14%, 1320 brands) — "monitored / verify first"
 *   score <  20  low         (~84%, 7818 brands) — "low signal"
 *
 * `frameAsScam` is TRUE only for `confirmed` and `high` (39 brands total,
 * top 0.42%) — the two tiers where the evidence is strong enough to use
 * declarative scam language in the prose. Everything else uses hedged
 * language to avoid defamation risk on brands that may be under-researched
 * rather than fraudulent.
 */

const TIERS = [
  {
    tier: 'confirmed',
    minScore: 80,
    label: 'Confirmed Scam — Do Not Deposit',
    shortLabel: 'Confirmed Scam',
    badge: '⚠️ CONFIRMED SCAM',
    prose: 'is a confirmed crypto investment scam',
    verdictOpener: 'is a confirmed crypto scam. Avoid all contact',
    frameAsScam: true,
  },
  {
    tier: 'high',
    minScore: 60,
    label: 'Very High Risk — Avoid All Contact',
    shortLabel: 'Very High Risk',
    badge: '⚠️ VERY HIGH RISK',
    prose: 'shows every hallmark of a crypto investment scam',
    verdictOpener: 'presents overwhelming evidence of fraudulent activity. Do not deposit',
    frameAsScam: true,
  },
  {
    tier: 'elevated',
    minScore: 40,
    label: 'High Risk — Exercise Extreme Caution',
    shortLabel: 'High Risk',
    badge: '⚠️ HIGH RISK',
    prose: 'exhibits multiple serious red flags consistent with investment fraud',
    verdictOpener: 'carries substantial risk. Treat with extreme caution',
    frameAsScam: false,
  },
  {
    tier: 'watchlist',
    minScore: 20,
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
