/**
 * FAQ Writer — produces all FAQ answers in one call.
 *
 * Input: array of { question, answer_hint? } from the approved outline.
 * Output: array of { question, answer } where answer is 40-90 words.
 *
 * Single call for all FAQs (vs section-per-call) because:
 * - The output is short (7 answers × 60 words = ~600 words total)
 * - Haiku handles small structured outputs in 8-15s easily
 * - FAQ answers benefit from being aware of each other (avoid repetition)
 *
 * Model: Haiku 4.5 primary, Sonnet retry. No deterministic fallback for the
 * whole FAQ block — instead, individual answers fall back to the
 * answer_hint text if Haiku/Sonnet both fail.
 */

const { callModel, extractJSON } = require('./ai-models')

function buildFaqSystem(persona) {
  const personaCore = String(persona?.systemPrompt || '')
    .split(/^ARTICLE STRUCTURE:/m)[0]
    .trim()

  return `${personaCore}

YOU ARE WRITING THE FAQ ANSWERS for an article. Other stages have already
written the body sections, title, summary, and key takeaways. Your sole
job: write a 40-90 word answer for each question, applying the persona
voice.

═══ RULES ═══
- DECLARATION-FIRST: Open each answer with the answer itself, not "Yes, X" or "Well, the question is...".
- For boolean questions, give the boolean answer in the first 8 words, then explain.
- Q&A WORD-ORDER MATCH (SC-032): mirror the question's word order in the first sentence. "How do I report X?" → "To report X, …". "Can I recover funds?" → "Recovering funds is possible when…".
- CERTAINTY MODALITY (SC-008): no "will/should/have to" in fact sentences — "Scammers demand fees", not "Scammers will demand fees".
- DECLARATION BEFORE CONDITION (SC-033): answer first, condition second — never open with "If …".
- NUMERIC SPECIFICITY: name actors, dates, amounts. No "several" / "many".
- Avoid repeating phrases across answers — readers see the FAQs as a block.
- Anti-slop: no "comprehensive", "robust", "leverage", "delve", "navigate", "ecosystem", "landscape".
- 40-90 words per answer. Hard limit at 110.
- No markdown formatting in answers (FAQs render as plain text).

═══ OUTPUT ═══
Return ONLY this JSON object — no preamble, no markdown fences:
{
  "faq": [
    { "question": "the question exactly as provided", "answer": "..." },
    ...
  ]
}

The faq array must contain the same number of items as the input, in the
same order, with the question text preserved verbatim.`
}

function buildFaqUser({ topic, faqs, sectionHeadings, targetKeyword }) {
  const faqBlock = (faqs || [])
    .map((f, i) => {
      const hint = f.answer_hint || f.answer || ''
      return `${i + 1}. Q: ${f.question}${hint ? `\n   Hint (use as factual anchor, not as the answer): ${hint}` : ''}`
    })
    .join('\n\n')

  const headingsBlock = (sectionHeadings || [])
    .map((h, i) => `  ${i + 1}. ${h}`)
    .join('\n')

  return `ARTICLE TOPIC: ${topic?.title || '(untitled)'}
TARGET KEYWORD: ${targetKeyword || '(none)'}

ARTICLE SECTIONS (for context — don't repeat their content in FAQs; expand on it):
${headingsBlock}

FAQS TO ANSWER:
${faqBlock}

Write the answers now. Each 40-90 words. Apply the persona voice. Return only the JSON object.`
}

async function writeFaq({
  topic,
  faqs,
  sectionHeadings,
  targetKeyword,
  persona,
  timeouts = { haikuMs: 30000, sonnetMs: 40000 },
  maxTokens = 2000,
}) {
  const system = buildFaqSystem(persona)
  const user = buildFaqUser({ topic, faqs, sectionHeadings, targetKeyword })
  const attempts = []

  if (!Array.isArray(faqs) || faqs.length === 0) {
    return { ok: true, faq: [], attempts: [{ stage: 'faq', label: 'skipped', ok: true, note: 'no faqs in outline' }] }
  }

  // Primary: Haiku
  const haikuStart = Date.now()
  try {
    const res = await callModel('claude-haiku', system, user, { maxTokens, timeoutMs: timeouts.haikuMs })
    const parsed = extractJSON(res.text)
    if (Array.isArray(parsed?.faq) && parsed.faq.length === faqs.length) {
      attempts.push({
        stage: 'faq', label: 'haiku-primary', model: res.model, modelKey: 'claude-haiku',
        ok: true, durationMs: Date.now() - haikuStart,
        stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      })
      return { ok: true, faq: parsed.faq, attempts }
    }
    throw new Error(`faq JSON shape invalid (got ${parsed?.faq?.length || 0} answers, expected ${faqs.length})`)
  } catch (e) {
    attempts.push({
      stage: 'faq', label: 'haiku-primary', model: 'claude-haiku', modelKey: 'claude-haiku',
      ok: false, durationMs: Date.now() - haikuStart,
      error: String(e?.message || e || 'unknown error').slice(0, 1500),
    })
  }

  // Retry: Sonnet
  const sonnetStart = Date.now()
  try {
    const res = await callModel('claude-sonnet', system, user, { maxTokens, timeoutMs: timeouts.sonnetMs })
    const parsed = extractJSON(res.text)
    if (Array.isArray(parsed?.faq) && parsed.faq.length === faqs.length) {
      attempts.push({
        stage: 'faq', label: 'sonnet-retry', model: res.model, modelKey: 'claude-sonnet',
        ok: true, durationMs: Date.now() - sonnetStart,
        stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      })
      return { ok: true, faq: parsed.faq, attempts }
    }
    throw new Error(`faq JSON shape invalid`)
  } catch (e) {
    attempts.push({
      stage: 'faq', label: 'sonnet-retry', model: 'claude-sonnet', modelKey: 'claude-sonnet',
      ok: false, durationMs: Date.now() - sonnetStart,
      error: String(e?.message || e || 'unknown error').slice(0, 1500),
    })
  }

  // Deterministic fallback — use answer_hints as answers
  const fallbackFaq = faqs.map((f) => ({
    question: f.question,
    answer: f.answer_hint || f.answer || `For specific guidance on this question, consult the article body and verify with official sources.`,
  }))
  attempts.push({
    stage: 'faq', label: 'deterministic-fallback',
    model: 'deterministic-fallback', modelKey: 'deterministic-fallback',
    ok: true, durationMs: 0,
    note: 'Both AI attempts failed; FAQ built from outline answer_hints',
  })
  return { ok: true, faq: fallbackFaq, deterministicFallback: true, attempts }
}

module.exports = { writeFaq, buildFaqSystem, buildFaqUser }
