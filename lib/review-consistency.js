// ═══════════════════════════════════════════════════════════════════
// lib/review-consistency.js — deterministic pre-insert validator
// Date: 2026-04-22
// ═══════════════════════════════════════════════════════════════════
//
// Runs AFTER the LLM returns content but BEFORE the Supabase INSERT.
//
// Catches numeric contradictions the writer model might still ship
// despite the prompt's hard constraint. The auditor (Phase 5 in
// polish/route.js) can also catch these, but (a) it runs a phase
// later and (b) it advises rather than gates. This validator is
// deterministic and mechanical — if prose says "26 celebrities"
// but the canonical list has 24, the INSERT either fixes or fails.
//
// Two modes, picked by caller:
//   - 'autofix': rewrite drifting numbers in-place, return the fixed
//                reviewContent + a log of what was changed. Default
//                for new generations.
//   - 'strict':  throw on any drift. Use for regenerations where the
//                caller wants to force a retry rather than silently fix.
//
// Does NOT touch schema-enrichment fields (those are validated by the
// normalizers in sync-shape.js). Only touches prose-level numeric
// claims about celebrity count, creative count, geo count, velocity,
// and longevity.

const NUMERIC_FIELDS_TO_CHECK = [
  'headline',
  'alternative_headline',
  'summary',
  'meta_description',
  'verdict',
  'how_it_works',
  'methodology',
  'expertise_depth',
  'not_for_you',
  'protection_steps',
  'disclaimer',
  'information_gain_summary',
]

// Plus the nested ones: key_takeaways[], red_flags[].detail,
// faq[].answer, experience_signals[]

/**
 * Walk a reviewContent object and find numeric claims about the
 * authoritative counts, rewriting drifted values to match the
 * canonical ones. Returns { content, drift: [...] } where drift
 * lists every rewrite performed.
 *
 * @param {object} reviewContent  the LLM's JSON output
 * @param {object} canonical      { celebrities, creatives, geos, velocity, longevity }
 * @param {'autofix'|'strict'} mode
 */
function enforceNumericConsistency(reviewContent, canonical, mode = 'autofix') {
  const drift = []

  // Build per-field replacement patterns. Each pattern captures the
  // numeric claim form ("N celebrities", "N ad creatives", etc.) with
  // enough specificity to avoid false positives on unrelated numbers.
  //
  // Each patternDef: { name, regex, canonical, noun, verbs }
  //   regex captures: (prefix)(number)(suffix with unit noun)
  //   canonical is the authoritative number
  //
  // The patterns are deliberately conservative. We'd rather miss a
  // drifting number than corrupt a legitimate one ("over 500 campaigns"
  // in the methodology boilerplate must NOT be touched by the celeb
  // count rule).

  const patterns = [
    {
      name: 'celebrities',
      // Matches "N celebrities" / "N public figures" / "N celebrity names"
      // / "N real public figures" etc. — allows one short adjective between
      // the number and the noun so "26 real public figures" is caught.
      // Excludes "500+ campaigns" / "2 million creatives" / "48 hours".
      regex: /\b(\d{1,3})\s+(?:(?:real|named|known|major|separate|distinct|individual|public|high-profile|notable)\s+){0,2}(celebrit(?:y|ies)|public figures?|celebrity names?|celebrity identit(?:y|ies)|celebrity endorsements?|impersonated (?:people|figures?))\b/gi,
      canonical: canonical.celebrities,
    },
    {
      name: 'creatives',
      regex: /\b(\d{1,4})\s+((?:fraudulent |scam |distinct |unique )?(?:ad )?creatives?|ads?\b(?! networks| platforms)|fraudulent (?:ads?|advertisements?))\b/gi,
      canonical: canonical.creatives,
    },
    {
      name: 'geos',
      // "N countries", "N nations", "N jurisdictions", "N geographies" — but
      // NOT "500+ campaigns" or "48 hours" or "60 days"
      regex: /\b(\d{1,3})\s+(countries|nations|jurisdictions|geographies|target geos)\b/gi,
      canonical: canonical.geos,
    },
    {
      name: 'longevity',
      regex: /\b(\d{1,4})\s+days?\s+(?:of\s+)?(?:active\s+)?(?:operation|activity|campaign|manipulation)\b/gi,
      canonical: canonical.longevity,
    },
    {
      name: 'velocity_7d',
      regex: /\b(\d{1,3})\s+new\s+(creatives?|ads?)\b/gi,
      canonical: canonical.velocity7d,
    },
  ].filter((p) => Number.isFinite(p.canonical) && p.canonical > 0)

  const fixInString = (str, fieldPath) => {
    if (typeof str !== 'string' || !str) return str
    let out = str
    for (const p of patterns) {
      out = out.replace(p.regex, (match, num, noun) => {
        const actual = parseInt(num, 10)
        if (actual === p.canonical) return match // no drift
        drift.push({
          field: fieldPath,
          metric: p.name,
          found: actual,
          canonical: p.canonical,
          snippet: match,
        })
        // Preserve the noun capitalization / pluralization as the LLM
        // wrote it. Just swap the number.
        return match.replace(/\d+/, String(p.canonical))
      })
    }
    return out
  }

  // Top-level scalar fields
  for (const field of NUMERIC_FIELDS_TO_CHECK) {
    if (typeof reviewContent[field] === 'string') {
      reviewContent[field] = fixInString(reviewContent[field], field)
    }
  }

  // key_takeaways[]
  if (Array.isArray(reviewContent.key_takeaways)) {
    reviewContent.key_takeaways = reviewContent.key_takeaways.map((kt, i) =>
      typeof kt === 'string' ? fixInString(kt, `key_takeaways[${i}]`) : kt,
    )
  }

  // red_flags[].detail and .flag
  if (Array.isArray(reviewContent.red_flags)) {
    reviewContent.red_flags = reviewContent.red_flags.map((rf, i) => {
      if (!rf || typeof rf !== 'object') return rf
      return {
        ...rf,
        flag: typeof rf.flag === 'string' ? fixInString(rf.flag, `red_flags[${i}].flag`) : rf.flag,
        detail: typeof rf.detail === 'string' ? fixInString(rf.detail, `red_flags[${i}].detail`) : rf.detail,
      }
    })
  }

  // faq[].answer
  if (Array.isArray(reviewContent.faq)) {
    reviewContent.faq = reviewContent.faq.map((f, i) => {
      if (!f || typeof f !== 'object') return f
      return {
        ...f,
        answer: typeof f.answer === 'string' ? fixInString(f.answer, `faq[${i}].answer`) : f.answer,
      }
    })
  }

  // experience_signals[]
  if (Array.isArray(reviewContent.experience_signals)) {
    reviewContent.experience_signals = reviewContent.experience_signals.map((sig, i) =>
      typeof sig === 'string' ? fixInString(sig, `experience_signals[${i}]`) : sig,
    )
  }

  // how_to.description + how_to.step[]/steps[].text
  // Accept both 'step' (schema.org canonical, used by prompt) and 'steps'
  // (legacy plural). The sync-shape normalizer already handles both; the
  // consistency validator must too or it silently skips numeric claims
  // inside HowTo steps when the prompt emits the canonical key.
  if (reviewContent.how_to && typeof reviewContent.how_to === 'object') {
    if (typeof reviewContent.how_to.description === 'string') {
      reviewContent.how_to.description = fixInString(
        reviewContent.how_to.description,
        'how_to.description',
      )
    }
    const howToStepsKey = Array.isArray(reviewContent.how_to.step)
      ? 'step'
      : Array.isArray(reviewContent.how_to.steps)
        ? 'steps'
        : null
    if (howToStepsKey) {
      reviewContent.how_to[howToStepsKey] = reviewContent.how_to[howToStepsKey].map((s, i) => {
        if (!s || typeof s !== 'object') return s
        return {
          ...s,
          text: typeof s.text === 'string' ? fixInString(s.text, `how_to.${howToStepsKey}[${i}].text`) : s.text,
        }
      })
    }
  }

  // Dataset description
  if (reviewContent.dataset && typeof reviewContent.dataset.description === 'string') {
    reviewContent.dataset.description = fixInString(
      reviewContent.dataset.description,
      'dataset.description',
    )
  }

  if (mode === 'strict' && drift.length > 0) {
    const summary = drift
      .slice(0, 5)
      .map((d) => `${d.field}: said ${d.found} ${d.metric}, canonical is ${d.canonical}`)
      .join('; ')
    const more = drift.length > 5 ? ` (and ${drift.length - 5} more)` : ''
    const err = new Error(`Numeric consistency drift: ${summary}${more}`)
    err.code = 'NUMERIC_DRIFT'
    err.drift = drift
    throw err
  }

  return { content: reviewContent, drift }
}

/**
 * Validate red-flag category distinctness. Returns { ok, duplicates }.
 *
 * The writer prompt now requires a `category` field on each red flag
 * (from the 8-item taxonomy: CELEBRITY, VELOCITY, REGULATORY, DOMAIN,
 * CORPORATE, LOCALIZATION, FUNNEL, PAYMENT). Two flags with the same
 * category indicate redundant coverage — the Floventra bug where
 * 3 of 8 flags were celebrity-related variants of the same phenomenon.
 *
 * For autofix behaviour: caller can use this to trigger a regeneration
 * request with the failing categories listed. For now it's observational.
 */
function validateRedFlagDistinctness(redFlags) {
  if (!Array.isArray(redFlags) || redFlags.length === 0) {
    return { ok: true, duplicates: [], categorized: 0 }
  }
  const bucket = new Map()
  let categorized = 0
  for (let i = 0; i < redFlags.length; i++) {
    const cat = redFlags[i]?.category
    if (!cat) continue
    categorized++
    const norm = String(cat).toUpperCase().trim()
    if (!bucket.has(norm)) bucket.set(norm, [])
    bucket.get(norm).push(i)
  }
  const duplicates = [...bucket.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([cat, indices]) => ({ category: cat, indices }))
  return {
    ok: duplicates.length === 0,
    duplicates,
    categorized,
    totalFlags: redFlags.length,
  }
}

module.exports = {
  enforceNumericConsistency,
  validateRedFlagDistinctness,
}
