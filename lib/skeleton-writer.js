/**
 * Skeleton Writer — produces the article's top-level metadata in one call.
 *
 * Output: { title, headline, meta_description, summary, key_takeaways }
 *
 * Runs first in the pipeline because:
 * - The summary needs the target keyword verbatim (the section writer
 *   coordinates with this — only section #1 also enforces keyword placement).
 * - key_takeaways guide the section writers' framing (we pass takeaways into
 *   each section's prompt as "the points readers should walk away with").
 * - title/headline/meta are the smallest output of all stages; doing this
 *   first lets later stages reference them if needed.
 *
 * Model: Haiku 4.5 (fastest, cheapest, fully sufficient for short structured output).
 */

const { callModel, extractJSON } = require('./ai-models')

function buildSkeletonSystem(persona, currentYear) {
  const personaCore = String(persona?.systemPrompt || '')
    .split(/^ARTICLE STRUCTURE:/m)[0]
    .trim()

  return `${personaCore}

YOU ARE WRITING THE ARTICLE METADATA AND KEY TAKEAWAYS — not the body content.
Other stages handle each section's prose, FAQ answers, internal links,
visual placeholders, and structured data. Your job: title, headline,
meta description, summary paragraph, and 4-6 key takeaways. Apply the
persona voice but stay focused on this narrow scope.

═══ RULES ═══
- DECLARATION-FIRST: Open the summary with the central finding.
- NUMERIC SPECIFICITY in summary: name actors, dates, amounts. No "several" / "many".
- Anti-slop: no "comprehensive", "robust", "dynamic", "landscape", "ecosystem", "leverage", "delve", "navigate".
- The target keyword phrase MUST appear verbatim in the summary field. Do not paraphrase or split it.
- Year context: ${currentYear}.

═══ FIELD CONSTRAINTS ═══
- title: ≤ 60 chars, descriptive, no clickbait
- headline: H1 with the keyword somewhere natural, ≤ 90 chars
- meta_description: ≤ 155 chars, action-oriented
- summary: 60-110 words, 2-3 sentences, MUST contain the target keyword verbatim
- key_takeaways: array of 4-6 strings, each 8-20 words, action-shaped or fact-shaped

═══ OUTPUT ═══
Return ONLY this JSON object — no preamble, no markdown fences:
{
  "title": "...",
  "headline": "...",
  "meta_description": "...",
  "summary": "...",
  "key_takeaways": ["...", "...", "...", "...", "..."]
}`
}

function buildSkeletonUser({ topic, parentTopic, sectionHeadings, targetKeyword }) {
  const headingsBlock = (sectionHeadings || [])
    .map((h, i) => `  ${i + 1}. ${h}`)
    .join('\n')

  return `TOPIC TITLE: ${topic?.title || '(untitled)'}
TARGET KEYWORD: ${targetKeyword || '(none — but still avoid keyword stuffing)'}
${parentTopic ? `PARENT TOPIC (for context, do NOT enter this scope): ${parentTopic.title}` : ''}
CONTENT TYPE: ${topic?.content_type || 'article'}

SECTIONS THE ARTICLE WILL CONTAIN (use to scope the summary correctly):
${headingsBlock}

Write the article metadata now. The summary must mention the target
keyword verbatim and orient the reader to what's coming. The key_takeaways
should be the 4-6 most important things a reader should walk away with —
they will be displayed as a "Key Takeaways" block at the top of the
rendered page, so write them as readable English, not section titles.

Return only the JSON object.`
}

/**
 * Run the skeleton writer with a small retry chain.
 * @returns {Promise<{ok, title?, headline?, meta_description?, summary?, key_takeaways?, attempts}>}
 */
async function writeSkeleton({
  topic,
  parentTopic,
  sectionHeadings,
  targetKeyword,
  persona,
  currentYear = new Date().getFullYear(),
  timeouts = { haikuMs: 25000, sonnetMs: 30000 },
  maxTokens = 800,
}) {
  const system = buildSkeletonSystem(persona, currentYear)
  const user = buildSkeletonUser({ topic, parentTopic, sectionHeadings, targetKeyword })
  const attempts = []

  // Primary: Haiku (fast + cheap; this is structured short output, well within Haiku's range)
  const haikuStart = Date.now()
  try {
    const res = await callModel('claude-haiku', system, user, {
      maxTokens,
      timeoutMs: timeouts.haikuMs,
    })
    const parsed = extractJSON(res.text)
    if (parsed?.title && parsed?.summary && Array.isArray(parsed?.key_takeaways)) {
      attempts.push({
        stage: 'skeleton', label: 'haiku-primary', model: res.model, modelKey: 'claude-haiku',
        ok: true, durationMs: Date.now() - haikuStart,
        stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      })
      return { ok: true, ...parsed, attempts }
    }
    throw new Error('skeleton JSON shape invalid')
  } catch (e) {
    attempts.push({
      stage: 'skeleton', label: 'haiku-primary', model: 'claude-haiku', modelKey: 'claude-haiku',
      ok: false, durationMs: Date.now() - haikuStart,
      error: String(e?.message || e || 'unknown error').slice(0, 1500),
    })
  }

  // Retry: Sonnet
  const sonnetStart = Date.now()
  try {
    const res = await callModel('claude-sonnet', system, user, {
      maxTokens,
      timeoutMs: timeouts.sonnetMs,
    })
    const parsed = extractJSON(res.text)
    if (parsed?.title && parsed?.summary && Array.isArray(parsed?.key_takeaways)) {
      attempts.push({
        stage: 'skeleton', label: 'sonnet-retry', model: res.model, modelKey: 'claude-sonnet',
        ok: true, durationMs: Date.now() - sonnetStart,
        stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      })
      return { ok: true, ...parsed, attempts }
    }
    throw new Error('skeleton JSON shape invalid')
  } catch (e) {
    attempts.push({
      stage: 'skeleton', label: 'sonnet-retry', model: 'claude-sonnet', modelKey: 'claude-sonnet',
      ok: false, durationMs: Date.now() - sonnetStart,
      error: String(e?.message || e || 'unknown error').slice(0, 1500),
    })
  }

  // Deterministic fallback — keep the article shippable
  const topicTitle = topic?.title || 'Crypto Scam Guide'
  const keyword = targetKeyword || topicTitle
  attempts.push({
    stage: 'skeleton', label: 'deterministic-fallback',
    model: 'deterministic-fallback', modelKey: 'deterministic-fallback',
    ok: true, durationMs: 0,
    note: 'Both AI attempts failed; skeleton built from topic data',
  })
  return {
    ok: true,
    title: topicTitle,
    headline: `${topicTitle} — Verification Guide`,
    meta_description: `Practical safety guide for ${keyword}. Red flags, verification steps, and what to do if targeted.`,
    summary: `This guide explains ${keyword} and how to verify claims before sending money. The ${currentYear} update covers current tactics and the actions readers can take in the first 60 seconds of a suspected encounter.`,
    key_takeaways: [
      `${topicTitle} follows a recognizable pattern across documented cases.`,
      'Independent verification (regulator, WHOIS, reverse image search) takes under 5 minutes.',
      'If money has already been sent, evidence preservation and fast reporting matter more than recovery promises.',
      'Recovery scams target confirmed victims — be wary of unsolicited "recovery agents".',
    ],
    deterministicFallback: true,
    attempts,
  }
}

module.exports = { writeSkeleton, buildSkeletonSystem, buildSkeletonUser }
