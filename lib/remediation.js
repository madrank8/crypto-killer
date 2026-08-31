'use strict'

/**
 * lib/remediation.js — the deterministic fix functions behind
 * scripts/remediate-investigations.mjs. Phase 1 remediation, 2026-08-31.
 *
 * Extracted into a lib so every transform is unit-testable against corpus
 * sentences — the first cut lived inside the script, applied a text edit by
 * mutating a closure variable inside a String.replace callback, and the outer
 * assignment silently discarded it. The plan LOGGED window corrections that
 * the apply step would never have made. Collect-then-splice makes each edit
 * an explicit region replacement on the original string, so what is logged is
 * exactly what is written.
 *
 * Three fix classes (policy approved 2026-08-31: adopt live brand score,
 * deterministic edits only):
 *   fixScoreLiterals   threat-score "N/100" literals → canonical score
 *   fixMetricLiterals  metric literals (+ their stale observation windows)
 *   fixRegister        fraud assertions / directives → the band's register
 */

const INLINE_TAGS = 'strong|em|b|i|u|a|mark|abbr|time|small|sup|sub'
const INLINE = `(?:</?(?:${INLINE_TAGS})[^>]*>|\\s)*`
const GAP = `(?:\\s|</?(?:${INLINE_TAGS})[^>]*>)+`

const METRICS = [
  { key: 'countries_targeted', noun: '(countries|nations|jurisdictions|geographies)' },
  { key: 'public_figures_impersonated', noun: `(celebrities|public${GAP}figures|celebrity${GAP}identities)` },
  { key: 'creatives_observed', noun: `((?:ad${GAP})?creatives)`, notAfter: /^\s*(?:per\s+(?:week|day)|weekly|daily|a\s+(?:week|day))/i },
  // Bare "N ads" is only trusted as the catalogue count when it stands alone
  // as a stat-card value (tag-bounded on both sides). In running prose the
  // same shape is usually a SUBSET ("28 ads targeted Italy") and rewriting it
  // to the total corrupts a true sentence.
  { key: 'creatives_observed', noun: '(ads)', tagBounded: true },
  { key: 'days_active', noun: `(days?(?:${GAP}of)?(?:${GAP}active)?${GAP}(?:operation|activity|campaign|running|continuous(?:${GAP}operation)?))` },
]
const PLATFORM_CONTEXT = /(reference database|our database|across our|crypto killer (?:tracks|monitors|has)|brands tracked|we monitor|platform-wide|\{\{platform_stat)/i

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec'
const WINDOW_RE = new RegExp(
  `between\\s+((?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?)\\s+and\\s+((?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?)`, 'i')

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const fmt = (n) => (n >= 1000 ? n.toLocaleString('en-US') : String(n))

function parseLoose(str, fallbackYear) {
  if (!str) return null
  const withYear = /\d{4}/.test(str) ? str : `${str}, ${fallbackYear}`
  const d = new Date(`${withYear.replace(/\./g, '')} UTC`)
  return Number.isNaN(d.getTime()) ? null : d
}
function shortDate(iso) {
  const d = new Date(iso)
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** Apply non-overlapping region replacements to a string, left to right. */
function splice(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const e of sorted) {
    if (e.start < cursor) continue // overlap — first edit wins
    out += text.slice(cursor, e.start) + e.replacement
    cursor = e.end
  }
  return out + text.slice(cursor)
}

// ─── score literals ───────────────────────────────────────────────────────

function fixScoreLiterals(text, oldScore, newScore, log, field) {
  if (typeof text !== 'string' || !text || !Number.isFinite(newScore)) return text
  let out = text
  if (Number.isFinite(oldScore) && oldScore !== newScore) {
    out = out.replace(new RegExp(`\\b${oldScore}(\\s*/\\s*100)\\b`, 'g'), (full, slash) => {
      log.push({ wave: 'A1', field, from: `${oldScore}/100`, to: `${newScore}/100` })
      return `${newScore}${slash}`
    })
  }
  out = out.replace(/\b(\d{1,3})(\s*\/\s*100)\b/g, (full, num, slash, idx) => {
    const n = Number(num)
    if (n === newScore || n > 100) return full
    const win = out.slice(Math.max(0, idx - 90), idx + full.length + 60)
    if (!/threat\s*(?:score|index)|scor(?:es|ing|ed)\b|rat(?:es|ed|ing)\b/i.test(win)) return full
    if (/audit|celebrity\s+impersonation|geographic\s+spread|campaign\s+(?:velocity|scale)|operation\s+longevity|trust\s*score|quality/i.test(win)) return full
    log.push({ wave: 'A2', field, from: `${num}/100`, to: `${newScore}/100`, context: stripTags(win).trim().slice(0, 120) })
    return `${newScore}${slash}`
  })
  return out
}

// ─── metric literals (collect-then-splice) ────────────────────────────────

function fixMetricLiterals(text, canon, log, field, dates = {}) {
  if (typeof text !== 'string' || !text) return text
  const edits = []

  for (const m of METRICS) {
    const target = canon[m.key]
    if (!Number.isFinite(target) || target <= 0) continue
    const re = new RegExp(`\\b([\\d][\\d,]*)(\\+?${INLINE})${m.noun}\\b`, 'gi')
    let match
    while ((match = re.exec(text)) !== null) {
      const [full, num, gap, noun] = match
      const idx = match.index
      const val = Number(String(num).replace(/,/g, ''))
      if (!Number.isFinite(val) || val === target || val <= 0) continue
      if (PLATFORM_CONTEXT.test(stripTags(text.slice(Math.max(0, idx - 90), idx)))) continue
      // Rate guards: "9 new creatives per week" is a rate, not the catalogue.
      if (m.notAfter && m.notAfter.test(stripTags(text.slice(idx + full.length, idx + full.length + 24)))) continue
      if (m.tagBounded) {
        const prev = text.slice(0, idx).match(/(>|^)\s*$/)
        const next = /^\s*(<|$)/.test(text.slice(idx + full.length))
        if (!prev || !next) continue
      }

      let end = idx + full.length
      let replacement = `${fmt(target)}${gap}${noun}`

      // A day-count next to "between <date> and <date>" describes that
      // window. The count and the window's end date move TOGETHER or not at
      // all — correcting one without the other fabricates a contradiction.
      if (m.key === 'days_active') {
        const rawTail = text.slice(end, end + 200)
        const win = rawTail.match(WINDOW_RE)
        if (win) {
          const year = dates.last_checked_date ? Number(dates.last_checked_date.slice(0, 4)) : new Date().getUTCFullYear()
          const d1 = parseLoose(win[1], year)
          const first = dates.first_detected_date ? new Date(dates.first_detected_date) : null
          const startsAtFirstDetected = d1 && first && Math.abs(d1 - first) <= 3 * 86400000
          if (!startsAtFirstDetected || !dates.last_checked_date) {
            log.push({ wave: 'B-skip', field, metric: m.key, from: `${num} … ${win[0].slice(0, 50)}`, to: 'LEFT AS-IS — window start does not match first-detected; needs writer regeneration' })
            continue
          }
          const newEnd = shortDate(dates.last_checked_date)
          const winStart = end + win.index
          const winEnd = winStart + win[0].length
          replacement += text.slice(end, winStart) + `between ${win[1]} and ${newEnd}`
          log.push({ wave: 'B', field, metric: 'observation_window', from: win[0].slice(0, 60), to: `between ${win[1]} and ${newEnd}` })
          end = winEnd
        }
      }

      log.push({ wave: 'B', field, metric: m.key, from: `${num} ${stripTags(noun).trim()}`, to: `${fmt(target)} ${stripTags(noun).trim()}` })
      edits.push({ start: idx, end, replacement })
    }
  }
  return edits.length ? splice(text, edits) : text
}

// ─── register alignment ───────────────────────────────────────────────────

const ASSERTION_SWAPS = [
  // Title-case headline assertion first, or the generic swap mangles it.
  { re: /\bIs\s+a\s+Confirmed\s+Crypto\s+Scam\b/g, to: 'Shows Strong Evidence of Crypto Fraud' },
  { re: /\b(is\s+a\s+)confirmed(\s+(?:crypto|investment|financial|rental)?\s*scam)\b/gi, to: '$1suspected$2' },
  { re: /\bis\s+a\s+fraudulent\s+(scheme|operation|platform|broker|site|service|company)\b/gi, to: 'displays the hallmarks of a fraudulent $1' },
  { re: /\bis\s+a\s+scam\b(?!\s+(?:intelligence|detection|surveillance|prevention|awareness|research|track\w*|watchdog|alert|report\w*))/gi, to: 'is a suspected scam' },
]
const DIRECTIVE_SWAP = {
  re: /\bDo\s+not\s+deposit\s+any\s+money\.?/gi,
  to: 'Verify the platform’s regulatory status independently before depositing any money.',
}

/** Same non-assertive guards as lib/editorial-language — never "soften" a
 *  sentence that is already correct. */
function guarded(text, idx) {
  const before = stripTags(text.slice(Math.max(0, idx - 160), idx)).split(/[.!?]/).pop()
  if (/\b(?:not|never|below|short\s+of)\b[^]{0,70}(?:threshold|criteri|designat|classif|qualif|met|meet|earn)/i.test(before)) return true
  if (/(?:threshold|criteri\w*|designat\w*)\s+(?:for|as)\s+(?:a|an)?\s*$/i.test(before)) return true
  if (/\bnot\s+(?:currently\s+|yet\s+)?(?:a|an)\s*$/i.test(before)) return true
  if (/\bwhether\b[^]{0,60}$/i.test(before)) return true
  if (/\b(?:likelihood|probabilit\w*|according\s+to|stating|states?\s+that|reports?\s+that|rated?\s+by|flagged\s+by)\b/i.test(before)) return true
  if (/(?:crypto\s*killer|cryptokiller)(?:'|’)s\s*$/i.test(before)) return true
  return false
}

function fixRegister(text, threat, log, field) {
  if (typeof text !== 'string' || !text || !threat) return text
  let out = text
  if (!threat.frameAsScam) {
    for (const swap of ASSERTION_SWAPS) {
      out = out.replace(swap.re, (...args) => {
        const full = args[0]
        const idx = args[args.length - 2]
        if (guarded(out, idx)) return full
        const single = new RegExp(swap.re.source, swap.re.flags.replace('g', ''))
        const to = full.replace(single, swap.to)
        log.push({ wave: 'C1', field, from: full, to, context: stripTags(out.slice(Math.max(0, idx - 110), idx + full.length + 70)).trim() })
        return to
      })
    }
  }
  if (!['ELEVATED_RISK', 'HIGH_RISK', 'CONFIRMED'].includes(threat.classification)) {
    out = out.replace(DIRECTIVE_SWAP.re, (full, idx) => {
      log.push({ wave: 'C2', field, from: full, to: DIRECTIVE_SWAP.to, context: stripTags(out.slice(Math.max(0, idx - 100), idx + full.length + 40)).trim() })
      return DIRECTIVE_SWAP.to
    })
  }
  return out
}

module.exports = {
  fixScoreLiterals,
  fixMetricLiterals,
  fixRegister,
  splice,
  guarded,
  METRICS,
  ASSERTION_SWAPS,
  DIRECTIVE_SWAP,
  WINDOW_RE,
  shortDate,
  parseLoose,
}
