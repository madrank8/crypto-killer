'use strict'

/**
 * lib/editorial-language.js — what a given evidence position lets you SAY.
 * Phase 1, 2026-08-31.
 *
 * Split out of lib/sync-shape.js so the publish gate, the validator, the
 * writer prompts and the sync shaper all test prose against ONE list. Two
 * copies of a "forbidden phrase" list is how a phrase gets fixed in one place
 * and keeps shipping from the other.
 */

/**
 * Language that asserts fraud as settled fact. Permitted only when
 * `threat.frameAsScam` is true — i.e. CONFIRMED band AND the methodology's
 * evidentiary test satisfied.
 *
 * Deliberately narrow. Hedged forms ("appears to be", "suspected", "shows
 * signs of", "warrants caution") are legitimate at lower bands and must not
 * match, or the validator becomes noise everyone learns to override.
 */
const FRAUD_ASSERTION_PATTERNS = Object.freeze([
  /\bconfirmed\s+(?:crypto|rental|investment|financial|fraud|fraudulent)?\s*scam\b/i,
  /\bis\s+a\s+(?:confirmed\s+)?(?:crypto|rental|investment|financial)?\s*scam\b/i,
  /\bis\s+(?:a\s+)?fraudulent\s+(?:platform|operation|scheme|broker|site|service|company)\b/i,
  /\bis\s+(?:a\s+)?(?:proven|outright|blatant)\s+(?:scam|fraud)\b/i,
  /\bthis\s+(?:platform|operation|company|broker)\s+(?:is|was)\s+stealing\b/i,
  /\b(?:they|the\s+operators?)\s+(?:steal|stole|are\s+stealing)\s+(?:your\s+)?(?:money|funds|deposits)\b/i,
  /\bguaranteed\s+to\s+lose\s+your\s+money\b/i,
])

/**
 * Safety DIRECTIVES. These tell a reader what to do; they do not assert that
 * fraud has been established. That distinction matters: at ELEVATED_RISK and
 * above, "do not deposit" is proportionate harm reduction and suppressing it
 * would make the page less useful and arguably less responsible. Below that
 * band we have said in the same breath that the evidence is insufficient, so
 * a flat instruction not to deposit asserts more than the file carries.
 */
const SAFETY_DIRECTIVE_PATTERNS = Object.freeze([
  // A conditional directive ("do not deposit WITHOUT verification / UNTIL
  // verified / UNLESS authorised") is verification advice, not a prohibition —
  // it is the register low bands are supposed to use, so it never matches.
  /\bdo\s+not\s+deposit\b(?!\s+(?:without|until|unless|before|money\s+without|funds\s+without))/i,
  /\bavoid\s+all\s+contact\b/i,
  /\bwithdraw\s+(?:your\s+)?(?:funds|money)\s+immediately\b/i,
])

/** Bands at which a safety directive is proportionate. */
const DIRECTIVE_MIN_CLASSIFICATIONS = Object.freeze(['ELEVATED_RISK', 'HIGH_RISK', 'CONFIRMED'])

/** Kept for callers that want every pattern in one list. */
const DEFINITIVE_FRAUD_PATTERNS = Object.freeze([...FRAUD_ASSERTION_PATTERNS, ...SAFETY_DIRECTIVE_PATTERNS])

/**
 * Hedges that make an otherwise-strong sentence acceptable at lower bands.
 * Used to avoid double-flagging "is a suspected scam".
 */
const HEDGE_PATTERNS = Object.freeze([
  /\bsuspected\b/i,
  // Probabilistic and attributed phrasings — "a strong likelihood the site is
  // a scam", "ScamAdviser … stating that …" report someone's assessment,
  // which is a different speech act from asserting the fact ourselves.
  /\blikelihood\b/i,
  /\bprobabilit\w*\b/i,
  /\b(?:according\s+to|stating\s+(?:that\s+)?there|states?\s+that|reports?\s+that|rated?\s+by|flagged\s+by)\b/i,
  /\balleged(?:ly)?\b/i,
  /\bappears?\s+to\b/i,
  /\bwhat\s+(?:appears|looks)\s+like\b/i,
  /\bconsistent\s+with\b/i,
  /\bwe\s+have\s+not\s+(?:verified|confirmed)\b/i,
])

/** True when a hedge in the same sentence softens the match. */
function isHedged(text, match) {
  const start = Math.max(0, match.index - 160)
  const sentence = text.slice(start, match.index + match[0].length + 80)
  return HEDGE_PATTERNS.some((h) => h.test(sentence))
}

/**
 * True when the matched phrase is not actually ASSERTING fraud — calibrated
 * against the live corpus (remediation pass, 2026-08-31), where 16 of 20
 * "assertion" hits turned out to be one of these shapes:
 *
 *   negated threshold   "has not met the evidentiary threshold for a
 *                        confirmed scam" — says the OPPOSITE of the claim
 *   designation meta    "has not been designated a confirmed scam",
 *                        "not a confirmed scam designation"
 *   corpus reference    "78% of CryptoKiller's confirmed scam cases"
 *   open question       "Whether Peak Luxentria is a scam remains …"
 *   self-description    "Crypto Killer is a scam intelligence platform"
 *
 * Softening these would corrupt correct — often exemplary — sentences, and a
 * gate that flags them trains editors to override it.
 */
function isNonAssertiveContext(text, match) {
  // Scope the look-behind to the CURRENT sentence: a negation two sentences
  // back must not launder a fresh assertion ("…has not met the threshold.
  // But Senvix is a confirmed crypto scam." is still an assertion).
  const windowBefore = text.slice(Math.max(0, match.index - 160), match.index)
  const before = windowBefore.split(/[.!?]/).pop()
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40)

  // "…threshold for a", "…criteria for a", "…designated a" directly before.
  if (/(?:threshold|criteri\w*|designat\w*|qualif\w*)\s+(?:for|as)\s+(?:a|an)?\s*$/i.test(before)) return true
  // A negation aimed at the classification, in the same clause.
  if (/\b(?:not|never|below|short\s+of)\b[^.!?]{0,70}(?:threshold|criteri|designat|classif|qualif|met|meet|earn)/i.test(before)) return true
  // "— not a confirmed scam", "not yet a confirmed scam".
  if (/\bnot\s+(?:currently\s+|yet\s+)?(?:a|an)\s*$/i.test(before)) return true
  // An open question, not a finding.
  if (/\bwhether\b[^.!?]{0,60}$/i.test(before)) return true
  // A reference to Crypto Killer's own corpus or taxonomy, not to this brand.
  if (/(?:crypto\s*killer|cryptokiller)(?:'|’)s\s*$/i.test(before)) return true
  if (/^\s*(?:designation|classification|status|label|threshold|criteri\w*|cases?|list|database|category)\b/i.test(after)) return true
  // "…is a scam intelligence platform" — 'scam' as an attributive noun for the
  // watchdog itself, not a predicate about the investigated brand.
  if (/^\s*(?:intelligence|detection|surveillance|prevention|awareness|research|tracking|tracker|watchdog|alert|report\w*)\b/i.test(after)) return true

  return false
}

function scan(text, patterns, kind) {
  for (const pattern of patterns) {
    // A pattern's first hit can sit in a hedged/meta context while a later
    // hit is a genuine assertion — walk every occurrence, not just the first.
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    let m
    while ((m = global.exec(text)) !== null) {
      if (isHedged(text, m) || isNonAssertiveContext(text, m)) continue
      const start = Math.max(0, m.index - 160)
      return { kind, phrase: m[0], context: text.slice(start, m.index + m[0].length + 80).trim().slice(0, 220) }
    }
  }
  return null
}

/**
 * The first unhedged claim in `text` that the given editorial position does not
 * license, or null.
 *
 * @param {string} text
 * @param {object} [position] { frameAsScam, classification } — omit to check
 *   only for fraud ASSERTIONS (the conservative default used by callers that
 *   have no classification to hand).
 */
function findDefinitiveFraudClaim(text, position = null) {
  if (typeof text !== 'string' || !text) return null

  // A fraud assertion is only licensed by frameAsScam.
  if (!position || position.frameAsScam !== true) {
    const hit = scan(text, FRAUD_ASSERTION_PATTERNS, 'assertion')
    if (hit) return hit
  }

  // A safety directive is licensed from ELEVATED_RISK up.
  const classification = position && typeof position.classification === 'string' ? position.classification : null
  const directiveAllowed = classification ? DIRECTIVE_MIN_CLASSIFICATIONS.includes(classification) : false
  if (!directiveAllowed) {
    const hit = scan(text, SAFETY_DIRECTIVE_PATTERNS, 'directive')
    if (hit) return hit
  }
  return null
}

/**
 * Strong factual allegations that need a source URL regardless of band —
 * these are assertions about the world, not about our own surveillance.
 */
const SOURCE_REQUIRING_PATTERNS = Object.freeze([
  { key: 'regulator_action', re: /\b(?:the\s+)?(FCA|SEC|CFTC|ASIC|BaFin|CONSOB|CNMV|AMF|FINMA|CySEC|FINRA|FTC|CSA|MAS|SFC)\b[^.]{0,120}\b(?:warned|warning|blacklist|banned|sanctioned|prosecut|action against|register)/i },
  { key: 'court_or_criminal', re: /\b(?:convicted|indicted|prosecuted|arrested|charged\s+with|court\s+ordered|criminal\s+investigation)\b/i },
  { key: 'named_loss_figure', re: /\b(?:victims?\s+lost|losses?\s+(?:of|totall?ing|exceeding)|stole\s+(?:over|more\s+than))\s*[£$€]?\s?[\d][\d,.]*\s?(?:m|bn|million|billion|k)?\b/i },
  { key: 'ownership_claim', re: /\bis\s+(?:owned|operated|run)\s+by\s+[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)*/ },
  { key: 'external_statistic', re: /\baccording\s+to\s+(?:a\s+)?(?:\d{4}\s+)?(?:study|report|survey|research|data)\b/i },
])

/** All strong allegations in `text` that would need a citation. */
function findSourceRequiringClaims(text) {
  if (typeof text !== 'string' || !text) return []
  const out = []
  for (const { key, re } of SOURCE_REQUIRING_PATTERNS) {
    const m = text.match(re)
    if (m) out.push({ key, phrase: m[0].trim().slice(0, 200) })
  }
  return out
}

/**
 * Paragraph openers that break extraction. An answer engine lifting a single
 * paragraph gets "It was first detected on 9 September 2025" with no subject.
 * Matched only at the START of a block.
 */
const AMBIGUOUS_OPENERS = Object.freeze([
  /^\s*(?:It|They|This\s+platform|This\s+company|This\s+operation|The\s+platform|The\s+company|The\s+site|These|Those|He|She)\b/i,
])

function hasAmbiguousOpener(paragraph) {
  if (typeof paragraph !== 'string') return false
  const p = paragraph.replace(/<[^>]+>/g, ' ').trim()
  if (p.length < 40) return false // headings and stubs are not extractable claims
  return AMBIGUOUS_OPENERS.some((re) => re.test(p))
}

module.exports = {
  FRAUD_ASSERTION_PATTERNS,
  SAFETY_DIRECTIVE_PATTERNS,
  DIRECTIVE_MIN_CLASSIFICATIONS,
  DEFINITIVE_FRAUD_PATTERNS,
  HEDGE_PATTERNS,
  SOURCE_REQUIRING_PATTERNS,
  AMBIGUOUS_OPENERS,
  findDefinitiveFraudClaim,
  findSourceRequiringClaims,
  hasAmbiguousOpener,
}
