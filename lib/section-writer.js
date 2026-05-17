/**
 * Section Writer — single-section agent for the article pipeline.
 *
 * Designed to run in parallel (Promise.all) across all 7 sections of an
 * article. Each call has a tight prompt (~1.5k input tokens) and a small
 * output target (~300 tokens), so it completes in 25-45s with Opus 4.6 at
 * effort:'low' — versus the monolithic writer's 120-200s for the entire
 * 7-section article.
 *
 * Why this is faster AND higher quality:
 * - Narrow scope per call → less adaptive thinking time
 * - Per-section retry isolation: one failure doesn't kill the article
 * - Opus runs full effort on each section instead of phoning in the
 *   last 2-3 sections after exhausting its working-memory budget
 * - Persona voice is uniformly applied (no drift mid-article)
 *
 * The full per-article rules (visual placeholders ≥3, social proof,
 * schema_enrichment, not_for_you, etc.) are NOT a section writer's
 * responsibility — those live in the aux-writer stage.
 *
 * SECTION SCOPE — what the writer is told to produce:
 *   Output: { heading, body }
 *   - body is 120-260 words of prose (markdown allowed: tables, lists,
 *     blockquotes, callouts, ### subheadings)
 *   - section opener follows declaration-first (no "This section explains...")
 *   - persona voice applies throughout
 *   - if isFirstSection AND target_keyword provided, keyword appears verbatim
 *     in first 200 words (the article's only keyword-placement enforcement
 *     point — skeleton writer puts it in summary too)
 *   - {{VERIFY:claim|source}} tags allowed for stat-bearing claims
 */

const { callModel, extractJSON } = require('./ai-models')

// Per-section rules — extracted from sharedTopicalWritingRules. Anything
// that's article-wide (visual count, schema_enrichment, social_proof) is
// excluded; only what governs THIS section's prose is included.
const SECTION_RULES = `═══ KORAY SEMANTIC RULES (per-section) ═══
- DECLARATION-FIRST: Open every sentence with the fact, not a dependent clause.
- NEVER open the section with "This section [verb]..." or any meta-description of itself. Open with the actual answer/finding.
- NEVER end the section with "This topic relates to the broader area of..." — no taxonomy trailers.
- NUMERIC SPECIFICITY: "3 methods" not "several methods". Name actors, dates, amounts.
- 3-EXAMPLE RULE: For every plural noun in the body, provide 3 concrete examples.
- DOMAIN VERBS: "targets", "exploits", "impersonates", "funnels", "deceives" — never "leverages", "harnesses", "delves".
- SALIENCE: Primary entity in subject position of opening sentences.
- CONTEXTUAL VECTOR: Stay within this section's described scope. Do not drift into adjacent sections.
- H3 SUBHEADINGS: If body exceeds 200 words OR covers 3+ distinct sub-points, include 1-2 ### subheadings (markdown). Use question format where natural.

═══ ANTI-SLOP RULES (per-section) ═══
BANNED openers/phrases: "In today's rapidly evolving", "It's important to note", "It's worth mentioning", "When it comes to", "Let's dive in", "In this comprehensive", "The question remains", "As we navigate"
BANNED crutches: "truly", "really", "quite", "certainly", "undoubtedly", "obviously", "needless to say"
BANNED verbs: "leverage", "harness", "utilize", "showcase", "highlight", "underscore", "delve into", "embark on", "streamline", "empower", "facilitate", "foster"
BANNED adjectives: "comprehensive", "robust", "dynamic", "cutting-edge", "innovative", "seamless", "holistic", "groundbreaking", "transformative", "game-changing"
BANNED nouns: "landscape", "ecosystem", "journey", "space" (industry use), "paradigm", "synergy", "realm"
BANNED structures: "serves as" / "functions as" → use "is" or show action; passive "It was determined that" → name who; "Experts say" without naming → name the expert.
RHYTHM: Vary sentence construction. Don't end on "This is why X matters" verdicts. Don't stack 3+ consecutive sub-8-word sentences.

═══ {{VERIFY}} TAGS ═══
Wrap any specific stat or named-source claim that requires human confirmation before publish:
- {{VERIFY: specific stat or claim | named source document}}
- {{SOURCE NEEDED: claim without citation | where to find it}}
Always name a specific document/page/URL. Don't tag vaguely.

═══ MARKDOWN FORMATTING ═══
Lightweight markdown allowed inside body:
- ### subheadings (use question format where natural)
- - bullet lists or 1. ordered lists
- | col | col | tables for comparisons
- > blockquote — attribution
- {{WARNING: text}} or {{TIP: text}} callouts
Use formatting variety where it earns its place. Plain prose is also fine when the content is narrative.

═══ FORBIDDEN ═══
- HTML tags (<div>, <p>, etc.) — markdown only
- Links: do NOT add internal or external links yourself. Internal linking is handled by a later stage.
- Sources: do NOT add a sources list. Sources are aggregated separately.
- Visual placeholders ([CHART NEEDED], [IMAGE NEEDED], etc.) — do NOT include. Visuals are decided in a later stage based on the full article.`

/**
 * Build the section writer's system prompt.
 * @param {object} persona - Persona object from writer-personas.js
 * @param {number} targetWordCount - Target word count for body (default 220)
 * @returns {string} System prompt
 */
function buildSectionSystem(persona, targetWordCount = 220) {
  // Use the persona's voice prefix. The section-mode prompt drops the
  // article-level structural rules ("ARTICLE STRUCTURE:" block, FAQ rules,
  // etc.) since the section writer is focused on one body of prose.
  const personaCore = String(persona?.systemPrompt || '')
    .split(/^ARTICLE STRUCTURE:/m)[0]
    .trim()

  return `${personaCore}

YOU ARE WRITING ONE SECTION OF A LARGER ARTICLE. Other stages handle the
title, summary, FAQ, internal links, visual placeholders, and structured
data. Your sole job: produce the body for the heading you're given,
applying the persona voice above.

${SECTION_RULES}

═══ OUTPUT ═══
Return ONLY this JSON object — no preamble, no markdown fences:
{
  "heading": "the heading exactly as provided to you",
  "body": "section body, target ${targetWordCount} words, markdown allowed"
}`
}

/**
 * Build the section writer's user prompt.
 * @param {object} args - { heading, description, key_points, target_word_count,
 *   target_keyword, requireKeywordInBody, prior_section_excerpt, topic_title }
 */
function buildSectionUser({
  heading,
  description,
  key_points = [],
  target_word_count = 220,
  target_keyword,
  requireKeywordInBody = false,
  prior_section_excerpt,
  topic_title,
}) {
  const keywordRule = requireKeywordInBody && target_keyword
    ? `\nKEYWORD PLACEMENT: The phrase "${target_keyword}" MUST appear verbatim somewhere in the first 200 words of your body. This is the article's only keyword-placement requirement; do not skip it.`
    : ''

  const continuityRule = prior_section_excerpt
    ? `\nCONTINUITY: The prior section ended with this passage. Don't repeat its content, but acknowledge the thread if natural:\n>>> ${String(prior_section_excerpt).slice(0, 320)}`
    : ''

  const kpBlock = key_points.length
    ? key_points.map((kp, i) => `  ${i + 1}. ${kp}`).join('\n')
    : '  (no key points provided — write to the description)'

  return `ARTICLE TOPIC: ${topic_title || '(unspecified)'}
SECTION HEADING: ${heading}
TARGET WORD COUNT: ${target_word_count} words
SECTION SCOPE: ${description || '(no description provided)'}

KEY POINTS TO COVER (use these as factual anchors, not as a checklist to recite):
${kpBlock}
${keywordRule}${continuityRule}

Write the section body now. Respect the target word count (±20%).
Open with a declaration-first answer to the heading, not a meta-description of what the section will cover.
Apply the persona voice. Return only the JSON object.`
}

/**
 * Try a section write attempt with one specific model. Captures full
 * diagnostic record. Does not throw on errors — returns ok:false instead,
 * so the caller's Promise.all doesn't reject.
 *
 * @param {object} args
 * @param {string} args.modelKey - 'claude-opus' | 'claude-sonnet' | 'claude-haiku'
 * @param {string} args.system
 * @param {string} args.user
 * @param {number} args.timeoutMs
 * @param {number} args.maxTokens
 * @param {object} args.meta - { sectionIndex, label } merged into the diagnostic
 * @returns {Promise<{ok, heading?, body?, error?, model, modelKey, durationMs, ...tokens, label, sectionIndex}>}
 */
async function attemptSectionWrite({ modelKey, system, user, timeoutMs, maxTokens, meta = {} }) {
  const startedAt = Date.now()
  try {
    const res = await callModel(modelKey, system, user, {
      maxTokens,
      timeoutMs,
    })
    const parsed = extractJSON(res.text)
    if (!parsed || typeof parsed.body !== 'string' || parsed.body.trim().length < 50) {
      throw new Error(`section JSON shape invalid (body length: ${parsed?.body?.length || 0})`)
    }
    return {
      ok: true,
      heading: parsed.heading || meta.heading,
      body: parsed.body,
      model: res.model || modelKey,
      modelKey,
      durationMs: Date.now() - startedAt,
      stopReason: res.stopReason || null,
      inputTokens: res.inputTokens || null,
      outputTokens: res.outputTokens || null,
      ...meta,
    }
  } catch (e) {
    const errMsg = String(e?.message || e || 'unknown error').slice(0, 1500)
    return {
      ok: false,
      error: errMsg,
      model: modelKey,
      modelKey,
      durationMs: Date.now() - startedAt,
      ...meta,
    }
  }
}

/**
 * Write a single section with primary → retry → deterministic-fallback chain.
 *
 * Strategy:
 *   1. Try Opus 4.6 (200000ms / 60000ms / 30000ms budgets passed by caller)
 *   2. If failed, try Sonnet 4.6 with same prompt (faster, ~25s typical)
 *   3. If both fail, return a deterministic-fallback body built from
 *      description + key_points so the article still ships with substance.
 *
 * Each attempt produces a record in `attempts[]` so the orchestrator can
 * persist them to ai_audit.pipeline_stages for diagnosis. The ok flag on
 * the returned envelope is true if EITHER attempt succeeded; the
 * deterministicFallback flag tells the caller to mark the section
 * accordingly so the publish quality gate can decide what to do.
 *
 * @param {object} args
 * @param {object} args.section - { heading, description, key_points, target_word_count }
 * @param {number} args.sectionIndex - 0-based index for diagnostics
 * @param {object} args.persona
 * @param {string} args.targetKeyword
 * @param {boolean} args.requireKeywordInBody - true only for the first section
 * @param {string} [args.priorSectionExcerpt] - last ~320 chars of prior section's body
 * @param {string} [args.topicTitle]
 * @param {object} [args.timeouts] - { opusMs, sonnetMs }
 * @param {number} [args.maxTokens]
 * @returns {Promise<{ok, heading, body, attempts, deterministicFallback}>}
 */
async function writeSection({
  section,
  sectionIndex,
  persona,
  targetKeyword,
  requireKeywordInBody,
  priorSectionExcerpt,
  topicTitle,
  timeouts = { opusMs: 60000, sonnetMs: 35000 },
  maxTokens = 1400,
}) {
  const targetWordCount = section.target_word_count || 220
  const system = buildSectionSystem(persona, targetWordCount)
  const user = buildSectionUser({
    heading: section.heading,
    description: section.description,
    key_points: section.key_points || [],
    target_word_count: targetWordCount,
    target_keyword: targetKeyword,
    requireKeywordInBody,
    prior_section_excerpt: priorSectionExcerpt,
    topic_title: topicTitle,
  })

  const attempts = []

  // Attempt 1: Opus 4.6 (primary, quality-first per user choice)
  const opusAttempt = await attemptSectionWrite({
    modelKey: 'claude-opus',
    system,
    user,
    timeoutMs: timeouts.opusMs,
    maxTokens,
    meta: {
      stage: `section-${sectionIndex + 1}`,
      label: 'opus-primary',
      sectionIndex,
      heading: section.heading,
    },
  })
  attempts.push(opusAttempt)
  if (opusAttempt.ok) {
    return {
      ok: true,
      heading: opusAttempt.heading,
      body: opusAttempt.body,
      attempts,
      deterministicFallback: false,
    }
  }

  // Attempt 2: Sonnet 4.6 retry (faster, often succeeds where Opus stalls)
  const sonnetAttempt = await attemptSectionWrite({
    modelKey: 'claude-sonnet',
    system,
    // Slight nudge for the retry so the model knows to be quick
    user: `${user}\n\nReturn the JSON object compactly. No preamble.`,
    timeoutMs: timeouts.sonnetMs,
    maxTokens,
    meta: {
      stage: `section-${sectionIndex + 1}`,
      label: 'sonnet-retry',
      sectionIndex,
      heading: section.heading,
    },
  })
  attempts.push(sonnetAttempt)
  if (sonnetAttempt.ok) {
    return {
      ok: true,
      heading: sonnetAttempt.heading,
      body: sonnetAttempt.body,
      attempts,
      deterministicFallback: false,
    }
  }

  // Attempt 3: deterministic fallback (still produces real prose from the brief).
  // Identical shape to the prior monolithic-fallback output for THIS section.
  const fallbackBody = buildDeterministicSectionBody(section)
  attempts.push({
    ok: true,
    stage: `section-${sectionIndex + 1}`,
    label: 'deterministic-fallback',
    sectionIndex,
    heading: section.heading,
    model: 'deterministic-fallback',
    modelKey: 'deterministic-fallback',
    durationMs: 0,
    note: 'Both AI attempts failed; section content built from outline brief',
  })
  return {
    ok: true,
    heading: section.heading,
    body: fallbackBody,
    attempts,
    deterministicFallback: true,
  }
}

/**
 * Build a section body from the outline brief. Used only when both Opus
 * and Sonnet fail. Output is grammatical English (description + key_points
 * joined as sentences) — substantive enough to be readable, but the
 * publish quality gate can detect the deterministic-fallback flag on the
 * pipeline_stages record and decide whether to allow publication.
 */
function buildDeterministicSectionBody(section) {
  const parts = []
  if (section.description) parts.push(String(section.description).trim())
  for (const kp of section.key_points || []) {
    const s = String(kp).trim()
    if (!s) continue
    // Ensure sentence-terminal punctuation
    parts.push(/[.!?]$/.test(s) ? s : `${s}.`)
  }
  return parts.join(' ').trim() || `Detailed information about ${section.heading} is being researched.`
}

module.exports = {
  writeSection,
  // Exported for testing / direct use:
  buildSectionSystem,
  buildSectionUser,
  buildDeterministicSectionBody,
}
