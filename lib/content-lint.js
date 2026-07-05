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
  /\bit'?s important to understand\b/i,
  /\bit'?s worth mentioning\b/i,
  /\bit is worth mentioning\b/i,
  /\bat the end of the day\b/i,
  /\bin the world of\b/i,
  /\bwhen it comes to\b/i,
  // canon v5.2 sync (2026-07-05): was /let'?s dive in\b/ which failed to
  // match "let's dive into" (the \b sat before "to")
  /\blet'?s dive in(?:to)?\b/i,
  /\bwithout further ado\b/i,
  /\bwithout wasting any more time\b/i,
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
  // ── canon v5.2 sync (audit 2026-07-05, W4b) — throat-clearers ──
  /\bin this (?:article|section|guide|post),?\s+(?:we|you)(?:'ll| will)\b/i,
  /\bas (?:we|i) mentioned earlier\b/i,
  /\bby the end of this (?:article|guide|post)\b/i,
  // Meta-commentary
  /\bthis is a complex topic\b/i,
  /\bthere'?s no one-size-fits-all\b/i,
  /\bthe answer depends on many factors\b/i,
  // False-honesty openers (sentence-initial only — "to be honest" mid-quote is fine)
  /(?:^|[.!?]\s+)(?:to be honest|honestly|frankly|let me be clear|make no mistake)\b[,:]?/i,
  // LLM-safe truths
  /\bit depends on your specific (?:needs|situation|circumstances)\b/i,
  /\bresults may vary\b/i,
  /\bevery situation is unique\b/i,
  // Filler transitions as paragraph openers
  /(?:^|\n)\s*(?:furthermore|moreover|additionally),/i,
  /\bin addition to the above\b/i,
  /\blast but not least\b/i,
  /\bthe bottom line is\b/i,
  /\bin a nutshell\b/i,
  // Vague declaratives (unsourced crowd claims)
  /\bmany (?:people|experts|investors) (?:believe|say|think|agree)\b/i,
  /\bstudies show\b/i,
  /\bresearch indicates\b/i,
  // Originality.ai high-multiple strings
  /\bplays a significant role in shaping\b/i,
  /\baims to explore\b/i,
  /\ba testament to\b/i,
  /\bserves as a reminder\b/i,
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
  // ── canon v5.2 sync (audit 2026-07-05, W4b) ──
  // verbs
  /\bhighlight(?:s|ed|ing)?\b/i,
  /\bunderscor(?:e|es|ed|ing)\b/i,
  /\bfacilitat(?:e|es|ed|ing)\b/i,
  /\bnavigat(?:e|es|ed|ing)\b/i, // metaphorical use; "as we navigate" is already an error
  // adjectives
  /\bdynamic\b/i,
  /\binnovative\b/i,
  /\bpivotal\b/i,
  /\bcrucial\b/i,
  /\bvital\b/i,
  /\bvibrant\b/i,
  /\bmultifaceted\b/i,
  /\bintricate\b/i,
  // nouns (metaphorical)
  /\bjourney\b/i,
  /\btapestry\b/i,
  /\btestament\b/i,
  /\bbeacon\b/i,
  // copula patterns (canon: >1/1000 words is a tell; single hits warn)
  /\bserves as an?\b/i,
  /\bfunctions as an?\b/i,
  /\bstands as an?\b/i,
  /\brepresents an? (?:significant|major|key|important)\b/i,
]

// ─── canon T4: protected domain vocabulary (audit 2026-07-05, W4b) ────
// NEVER add these to the kill lists, and any future automated cleanup must
// skip them — Koray-required domain verbs/nouns that carry the entity
// semantics of a scam-investigation corpus. (Subset of canon's 73-word T4
// list relevant to this domain.)
const PROTECTED_VOCAB = [
  'exploits', 'impersonates', 'targets', 'funnels', 'deceives',
  'fabricates', 'launders', 'extracts', 'defrauds', 'clones',
  'threat', 'evidence', 'investigation', 'surveillance', 'creative',
  'withdrawal', 'deposit', 'regulator', 'warning', 'velocity',
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

  // ── canon v5.2 T2 density rules (audit 2026-07-05, W4b) — warnings ──
  // Density-capped vocabulary: individually fine, a tell in bulk.
  const allText = (fields || []).map((f) => normalizeForLint(f.text)).join('\n\n')
  const totalWords = allText.split(/\s+/).filter(Boolean).length
  if (totalWords > 300) {
    const per1000 = (n) => (n / totalWords) * 1000

    // T2a: formal connectives ≤2 per 1000 words
    const connectives = (allText.match(/\b(?:furthermore|moreover|additionally|consequently|subsequently|nevertheless|nonetheless)\b/gi) || []).length
    if (per1000(connectives) > 2) {
      warnings.push(`T2 density: ${connectives} formal connectives (furthermore/moreover/additionally/…) in ~${totalWords} words — cap is 2 per 1000. Vary transitions or cut them.`)
    }

    // T2b: connectives must never open paragraphs (beyond the hard-banned trio)
    const paraOpeners = (allText.match(/(?:^|\n\n)\s*(?:however|consequently|subsequently|nevertheless|nonetheless|therefore|thus),/gi) || []).length
    if (paraOpeners > 1) {
      warnings.push(`T2 density: ${paraOpeners} paragraphs open with a formal connective — paragraph openers should carry content, not transitions.`)
    }

    // T2c: corporate verbs ≤3 per 1000 words (beyond the singles already warned)
    const corporate = (allText.match(/\b(?:leverag\w*|utiliz\w*|facilitat\w*|streamlin\w*|optimiz\w*)\b/gi) || []).length
    if (per1000(corporate) > 3) {
      warnings.push(`T2 density: ${corporate} corporate verbs (leverage/utilize/facilitate/…) in ~${totalWords} words — cap is 3 per 1000.`)
    }

    // T2d: puffery adjectives require a measurable qualifier nearby
    const pufferyHits = [...allText.matchAll(/\b(?:significant|substantial|considerable|extensive|remarkable)\b/gi)]
    let unquantified = 0
    for (const m of pufferyHits) {
      const windowText = allText.slice(Math.max(0, m.index - 80), m.index + 120)
      if (!/\d/.test(windowText)) unquantified++
    }
    if (unquantified >= 3) {
      warnings.push(`T2 density: ${unquantified} puffery adjectives (significant/substantial/…) with no number in the same sentence — attach a measurable qualifier or cut (AAG Category 4).`)
    }
  }

  return { errors, warnings }
}

// ─── Shared prompt block (audit 2026-07-05, W4b) ─────────────────────
// SINGLE SOURCE OF TRUTH for the anti-slop rules embedded in writer
// prompts. Four files used to carry hand-copied, slightly-divergent kill
// lists (review-prompts / content-prompts / section-writer / auditor);
// they now append this constant so prompt bans and the deterministic lint
// above cannot drift apart again. Keep this in sync with the regex lists —
// when you add a phrase above, add it here.
const ANTI_SLOP_PROMPT_BLOCK = `
═══ ANTI-SLOP — CANONICAL BANNED LIST (enforced by a deterministic publish gate; violations BLOCK publish) ═══
BANNED PHRASES (hard errors): "it's important to note/understand", "it's worth mentioning", "in today's rapidly evolving", "at the end of the day", "in the world of", "when it comes to", "let's dive in/into", "without further ado", "without wasting any more time", "in this comprehensive", "one thing is clear", "the question remains", "only time will tell", "as we navigate", "stay tuned", "before we get into", "now that we've covered", "in this article/section we will", "as we mentioned earlier", "by the end of this article", "this is a complex topic", "there's no one-size-fits-all", "the answer depends on many factors", sentence-initial "to be honest/honestly/frankly/let me be clear/make no mistake", "it depends on your specific needs", "results may vary", "every situation is unique", paragraph-opening "Furthermore/Moreover/Additionally,", "in addition to the above", "last but not least", "the bottom line is", "in a nutshell", "many people/experts believe", "studies show", "research indicates" (name the actual study or cut), "plays a significant role in shaping", "aims to explore", "a testament to", "serves as a reminder", "in summary,", "to recap,".
BANNED VOCABULARY (warnings — avoid): leverage, harness, utilize, showcase, delve into, embark on, revolutionize, streamline, empower, foster, highlight, underscore, facilitate, navigate (metaphorical), comprehensive, robust, cutting-edge, seamless, holistic, groundbreaking, transformative, game-changing, dynamic, innovative, pivotal, crucial, vital, vibrant, multifaceted, intricate, very, truly, really, quite, certainly, undoubtedly, obviously, clearly, landscape, ecosystem, paradigm, synergy, realm, journey, tapestry, testament, beacon, "serves/functions/stands as a".
DENSITY RULES: formal connectives (furthermore/moreover/additionally) max 2 per 1000 words and NEVER as paragraph openers; corporate verbs max 3 per 1000 words; every puffery adjective (significant/substantial/considerable) needs a NUMBER in the same sentence.
PROTECTED DOMAIN VOCABULARY (always allowed, never "fix" these): exploits, impersonates, targets, funnels, deceives, fabricates, launders, extracts, defrauds, clones, threat, evidence, investigation, surveillance, creative, withdrawal, deposit, regulator, warning, velocity.
═══════════════════════════════════════════════`

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

// ─── Structural HTML-pollution detector ───
//
// Defense-in-depth for the long-form `full_article` body. A YMYL review/article
// body is a *fragment* of HTML (headings, paragraphs, lists, tables). It must
// never contain: a full document shell (<!doctype/<html>/<head>/<body>), raw
// <script>/<style> tags, or a serialized JSON-LD / structured-data blob. Any of
// those, when injected by the public renderer, produces the "page rendered N
// times / JSON dumped as visible text" failure mode. The stored data was clean
// in the incident that motivated this (the bug was render-side), but the publish
// gate is the right place to guarantee the pipeline can never *emit* a body that
// would break a downstream renderer. (Audit: YMYL writing-process review.)
//
// Returns an array of human-readable reasons (empty = clean).
function detectHtmlPollution(html, label = 'full_article') {
  const reasons = []
  if (typeof html !== 'string' || !html.trim()) return reasons
  const checks = [
    [/<!doctype/i, 'a <!doctype> declaration (full HTML document, not a body fragment)'],
    [/<html[\s>]/i, 'an <html> tag (full document embedded in the body)'],
    [/<head[\s>]/i, 'a <head> tag'],
    [/<body[\s>]/i, 'a <body> tag'],
    [/<\/script>/i, 'a </script> tag (can break the page out of a script context)'],
    [/<script[\s>]/i, 'a raw <script> tag'],
    [/"@context"\s*:\s*"https?:\/\/schema\.org"/i, 'an embedded JSON-LD block ("@context":"schema.org") — structured data belongs in the schema graph, not the body'],
  ]
  for (const [re, desc] of checks) {
    if (re.test(html)) reasons.push(`${label} contains ${desc}`)
  }
  // A run of serialized structured-data objects leaking as text (e.g.
  // {"@type":"Thing",...},{"@type":"Person",...}) even without an @context.
  const atTypeCount = (html.match(/"@type"\s*:/g) || []).length
  if (atTypeCount >= 3) {
    reasons.push(`${label} contains ${atTypeCount} serialized "@type" objects — a structured-data dump is leaking into the body`)
  }
  return reasons
}

module.exports = {
  lintProseFields,
  collectArticleProseFields,
  detectHtmlPollution,
  KILL_PHRASES,
  KILL_VOCAB,
  PLURAL_MISMATCH_PATTERNS,
  PROTECTED_VOCAB,
  ANTI_SLOP_PROMPT_BLOCK,
}
