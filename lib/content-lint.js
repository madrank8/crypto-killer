/**
 * lib/content-lint.js — deterministic prose lint for the publish gates
 * Date: 2026-06-10
 *
 * Closes the P0-3 gap from the content-pipeline skill audit: five anti-slop
 * kill lists exist in the writer prompts and the Phase 5 auditor prompt, but
 * both are LLM honor-system. Nothing deterministic ever scanned the prose.
 * This module is a zero-cost regex scanner that runs inside both publish
 * gates (reviews + articles) so the documented kill lists are ENFORCED, not
 * advised.
 *
 * Severity model:
 *   - KILL_PHRASES  → errors   (AI-tell sentence patterns; unambiguous, no
 *                               legitimate use in this corpus)
 *   - KILL_VOCAB    → warnings (single words; bannable in prompts but too
 *                               context-dependent to hard-block a publish)
 *   - PLURAL_MISMATCH_PATTERNS → warnings (existing behavior, moved here
 *                               from reviews/[id]/publish so both pipelines
 *                               share one list)
 *
 * Flip a phrase between severities by moving it between the two lists —
 * the gate code doesn't special-case anything.
 */

// ─── Kill list 1: AI-tell phrases (ERRORS) ───────────────────────────
// Mirror of the writer prompts' "ANTI-SLOP KILL LIST 1" + auditor list.
// Word-boundary, case-insensitive. These never appear in copy a human
// editor would approve, so a hit is safe to hard-block.
const KILL_PHRASES = [
  /\bin today'?s rapidly evolving\b/i,
  /\bit'?s important to note\b/i,
  /\bit is important to note\b/i,
  /\bit'?s worth mentioning\b/i,
  /\bit is worth mentioning\b/i,
  /\bat the end of the day\b/i,
  /\bin the world of\b/i,
  /\bwhen it comes to\b/i,
  /\blet'?s dive in\b/i,
  /\bwithout further ado\b/i,
  /\bin this comprehensive\b/i,
  /\bone thing is clear\b/i,
  /\bthe question remains\b/i,
  /\bonly time will tell\b/i,
  /\bas we navigate\b/i,
  /\bstay tuned\b/i,
  /\bbefore we get into\b/i,
  /\bnow that we'?ve covered\b/i,
  // Structure tells (writer prompt "KILL LIST 4" / publish-gate adjacent)
  /\bthis (?:review|article|guide) will show you\b/i,
  // Section-end recap tells (GLOBAL FORBIDDEN PATTERNS in content-prompts)
  /(?:^|\n)\s*in summary,/i,
  /(?:^|\n)\s*to recap,/i,
]

// ─── Kill list 2: slop vocabulary (WARNINGS) ─────────────────────────
// From the writer prompts' banned verbs/adjectives/nouns. Warnings, not
// errors: single words occasionally have legitimate uses ("the robust
// regulatory framework" in a quoted source, "journey" inside a victim
// quote). The editor sees the warning and decides.
// NOTE: domain verbs (exploits, impersonates, targets, funnels, deceives)
// are PROTECTED in the prompts and intentionally absent here.
const KILL_VOCAB = [
  // verbs
  /\bleverag(?:e|es|ed|ing)\b/i,
  /\bharness(?:es|ed|ing)?\b/i,
  /\butiliz(?:e|es|ed|ing)\b/i,
  /\bshowcas(?:e|es|ed|ing)\b/i,
  /\bdelv(?:e|es|ed|ing) into\b/i,
  /\bembark(?:s|ed|ing)? on\b/i,
  /\brevolutioniz(?:e|es|ed|ing)\b/i,
  /\bstreamlin(?:e|es|ed|ing)\b/i,
  /\bempower(?:s|ed|ing)?\b/i,
  /\bfoster(?:s|ed|ing)?\b/i,
  // adjectives
  /\bcomprehensive\b/i,
  /\brobust\b/i,
  /\bcutting-edge\b/i,
  /\bseamless\b/i,
  /\bholistic\b/i,
  /\bgroundbreaking\b/i,
  /\btransformative\b/i,
  /\bgame-chang(?:ing|er)\b/i,
  // nouns
  /\blandscape\b/i,
  /\becosystem\b/i,
  /\bparadigm\b/i,
  /\bsynergy\b/i,
  /\brealm\b/i,
]

// ─── Plural agreement (WARNINGS) ─────────────────────────────────────
// Moved from app/api/admin/reviews/[id]/publish/route.js so reviews and
// articles share one list. Singular form goes in .detail.
const PLURAL_MISMATCH_PATTERNS = [
  { re: /\b1\s+countries\b/i, detail: '1 country (singular)' },
  { re: /\b1\s+days\b/i, detail: '1 day (singular)' },
  { re: /\b1\s+creatives\b/i, detail: '1 creative (singular)' },
  { re: /\b1\s+celebrities\b/i, detail: '1 celebrity (singular)' },
  { re: /\b1\s+sources\b/i, detail: '1 source (singular)' },
  { re: /\b1\s+flags\b/i, detail: '1 flag (singular)' },
  { re: /\b1\s+platforms\b/i, detail: '1 platform (singular)' },
  { re: /\b1\s+brands\b/i, detail: '1 brand (singular)' },
  { re: /\b1\s+weeks\b/i, detail: '1 week (singular)' },
  { re: /\b1\s+months\b/i, detail: '1 month (singular)' },
  { re: /\b1\s+years\b/i, detail: '1 year (singular)' },
  { re: /\b1\s+victims\b/i, detail: '1 victim (singular)' },
]

// Stat tokens resolve at render time — "{{stat:countries_targeted}} countries"
// is correct authoring, so strip tokens before plural checks to avoid false
// positives, and strip HTML so attribute text doesn't trip vocab rules twice.
function normalizeForLint(text) {
  return String(text || '')
    .replace(/\{\{(?:platform_)?stat:[^}]+\}\}/g, 'N')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function snippetAround(text, index, span = 70) {
  const start = Math.max(0, index - 20)
  return text.slice(start, start + span).replace(/\s+/g, ' ').trim()
}

/**
 * Lint an array of prose fields [{label, text}].
 *
 * @param {Array<{label: string, text: string}>} fields
 * @param {object} [opts]
 * @param {boolean} [opts.phrasesAsErrors=true]  — flip to false to demote
 *   kill-phrase hits to warnings (e.g. during a backfill of legacy rows)
 * @returns {{ errors: string[], warnings: string[] }}
 */
function lintProseFields(fields, opts = {}) {
  const { phrasesAsErrors = true } = opts
  const errors = []
  const warnings = []

  for (const { label, text } of fields || []) {
    const clean = normalizeForLint(text)
    if (!clean.trim()) continue

    for (const re of KILL_PHRASES) {
      const m = clean.match(re)
      if (m) {
        const msg = `AI-tell phrase in \`${label}\`: "${m[0]}" — banned by the anti-slop kill list. Rewrite the sentence (context: "…${snippetAround(clean, m.index)}…").`
        ;(phrasesAsErrors ? errors : warnings).push(msg)
      }
    }

    for (const re of KILL_VOCAB) {
      const m = clean.match(re)
      if (m) {
        warnings.push(`Slop vocabulary in \`${label}\`: "${m[0]}" — banned by the writer prompt's vocabulary kill list. Replace unless it appears inside a verbatim quote.`)
      }
    }

    for (const p of PLURAL_MISMATCH_PATTERNS) {
      const m = clean.match(p.re)
      if (m) {
        warnings.push(`Plural mismatch in \`${label}\`: "${m[0]}" should be ${p.detail}.`)
      }
    }
  }

  return { errors, warnings }
}

/**
 * Collect the prose fields of an ARTICLE row (content table shape) into
 * the [{label, text}] form lintProseFields expects. Reviews already have
 * their own collector in the publish route.
 */
function collectArticleProseFields(content) {
  const fields = []
  const push = (label, val) => {
    if (typeof val === 'string' && val.trim()) fields.push({ label, text: val })
  }
  push('title', content.title)
  push('headline', content.headline)
  push('meta_description', content.meta_description)
  push('summary', content.summary)
  push('not_for_you', content.not_for_you)
  push('information_gain_summary', content.information_gain_summary)

  const sections = Array.isArray(content.sections) ? content.sections : []
  sections.forEach((s, i) => {
    push(`sections[${i}] "${String(s?.heading || '').slice(0, 50)}"`, s?.body)
  })
  const faq = Array.isArray(content.faq) ? content.faq : []
  faq.forEach((f, i) => {
    push(`faq[${i}].answer`, f?.answer)
  })
  const takeaways = Array.isArray(content.key_takeaways) ? content.key_takeaways : []
  takeaways.forEach((t, i) => push(`key_takeaways[${i}]`, typeof t === 'string' ? t : t?.text))

  return fields
}

module.exports = {
  lintProseFields,
  collectArticleProseFields,
  KILL_PHRASES,
  KILL_VOCAB,
  PLURAL_MISMATCH_PATTERNS,
}
