/**
 * Aux Writer — produces the article-level fields that aren't body content.
 *
 * Output: {
 *   not_for_you,          // 80-120 word block
 *   social_proof,         // ≥2 named-source items
 *   visual_placeholders,  // ≥3 with specific descriptions and alt text
 *   internal_links,       // ≥2 entries with REAL slugs from publishedSlugs
 *   schema_enrichment,    // 11-field schema enrichment object
 *   information_gain_summary,
 *   not_for_you,
 *   author_bio
 * }
 *
 * This stage runs AFTER the section bodies are written, so it has the
 * full article text as context. Knowing what's already in the body makes
 * social_proof selection (which expert quote is relevant?), visual
 * placeholder placement (where does a chart actually help?), and internal
 * linking (which mentioned entities should we link?) much more accurate
 * than the current monolithic flow which produces these blind.
 *
 * Model: Haiku 4.5 — structured output, narrow scope, fast.
 *
 * The schema_enrichment fields (about_slugs, mention_slugs, citations,
 * speakable_selectors, dataset, etc.) are critical for Google rich results
 * and AI Overview citations. Mention_slugs in particular: every named
 * person/org in the body should be in this array, and it's much easier
 * for the model to extract them when looking at the actual finished body
 * vs predicting them in advance.
 */

const { callModel, extractJSON } = require('./ai-models')

function buildAuxSystem(persona, currentYear) {
  const personaCore = String(persona?.systemPrompt || '')
    .split(/^ARTICLE STRUCTURE:/m)[0]
    .trim()

  return `${personaCore}

YOU ARE WRITING THE ARTICLE'S AUXILIARY FIELDS — not the body.
Body sections, title, summary, FAQ are already written and provided to you
as context. Your job: produce the fields below, drawn from what's actually
in the body. Apply the persona voice for free-text fields.

═══ FIELDS TO PRODUCE ═══

not_for_you (string, 80-120 words):
  Named scenarios where this article does NOT apply. MUST include at least
  one specific exclusion a competitor article wouldn't bother to write.
  Examples of strong not_for_you content:
  - "Already lost funds and looking for recovery — this guide is preventive; for recovery, see [other resource]."
  - "Specifically researching [adjacent topic X] — this article focuses on Y, not X."
  - "Already following [specific verification practice] — you're past this guide's level."

social_proof (array, exactly 2-4 items):
  At least 2 named sources. Each item shape:
  { type: "expert_quote" | "community" | "industry" | "study",
    source: "named person, subreddit, or organization",
    content: "exact quote OR specific insight (do not fabricate quotes — describe insights)",
    attribution: "interview/article/report title and date" }
  At least one item must be type="study" with named methodology/sample size.
  Pull names from the article body — do NOT invent new sources.

visual_placeholders (array, 3-5 items):
  Each shape: "[CHART NEEDED: specific description | Alt: descriptive alt text]"
  Or: "[IMAGE NEEDED: ...]" or "[DIAGRAM NEEDED: ...]" or "[SCREENSHOT NEEDED: ...]"
  Place placeholders that genuinely add information — comparison charts,
  process diagrams, illustrative images of mentioned objects/UIs. NOT
  decorative stock photos. Each must have unique alt text.
  Reference what's actually mentioned in the body sections.

internal_links (array, 2-5 items):
  Each shape: { anchor_text, target_slug, context }
  REQUIRED: target_slug must be a real path from the published-slug list provided
  in the user prompt. Do NOT invent target_slug values. Do NOT use "#" or "TBD".
  anchor_text should be a phrase that actually appears in the article body.

schema_enrichment (object, all 6 fields required):
  {
    "about_slugs": [1-3 short kebab-case slugs for primary topics — e.g.
      "celebrity-crypto-scam", "pig-butchering-scam", "rug-pull"],
    "mention_slugs": [≥5 kebab-case slugs for every named person, org,
      government body, platform, product mentioned in the article body —
      e.g. "elon-musk", "ftc", "binance", "coinbase"],
    "speakable_selectors": [".key-takeaways", optionally ".tldr" or ".summary"],
    "citations": [one entry per source — { name, url, type, publisher, datePublished }
      where type ∈ NewsArticle | ScholarlyArticle | Report | WebPage | GovernmentService],
    "dataset": null OR { name, description, url, datePublished, variableMeasured: [...] }
      (only populated if the article cites CryptoKiller first-party data),
    "primary_about_slug": "the most central about_slug for the article"
  }

information_gain_summary (string, 1-2 sentences):
  What unique data does this page offer that competitors don't?

author_bio (string, 1-2 sentences):
  Bio for the persona writing this article (do NOT lead with the persona's
  name — the renderer prepends it). Format: "investigates [domain] at CryptoKiller."

verify_tags_count (integer):
  Count of {{VERIFY:...}} tags found in the body sections you're given.
  If 0, that's fine for non-stat articles.

reddit_test_passed (boolean):
  Honestly evaluate: would a knowledgeable practitioner on r/cryptocurrency
  or r/Scams upvote this? True only if specific non-obvious info beyond
  Google's top 10 results.

═══ ANTI-SLOP ═══
No "comprehensive", "robust", "dynamic", "leverage", "delve", "navigate",
"ecosystem", "landscape", "journey", "space" (industry use), "synergy".

═══ OUTPUT ═══
Return ONLY this JSON object — no preamble, no markdown fences. All listed
fields are required. Year context: ${currentYear}.
{
  "not_for_you": "...",
  "social_proof": [...],
  "visual_placeholders": [...],
  "internal_links": [...],
  "schema_enrichment": {...},
  "information_gain_summary": "...",
  "author_bio": "...",
  "verify_tags_count": 0,
  "reddit_test_passed": true
}`
}

function buildAuxUser({ topic, persona, sections, faq, summary, sourceLedger, publishedSlugs, platformIntelligence }) {
  const sectionsBlock = (sections || [])
    .map((s, i) => `### Section ${i + 1}: ${s.heading}\n\n${(s.body || '').slice(0, 2000)}`)
    .join('\n\n---\n\n')

  const faqBlock = (faq || [])
    .map((f) => `Q: ${f.question}\nA: ${f.answer || f.answer_hint || ''}`)
    .join('\n\n')

  const reviewSlugs = publishedSlugs?.reviews || []
  const contentSlugs = publishedSlugs?.content || []
  const slugsBlock = `PUBLISHED SLUGS (use REAL paths from these in internal_links — do NOT invent):
Reviews (${reviewSlugs.length}):
${reviewSlugs.slice(0, 30).map((s) => `  - "${s.name}" → /review/${s.slug}`).join('\n')}

Blog articles (${contentSlugs.length}):
${contentSlugs.slice(0, 20).map((s) => `  - "${s.title}" → /blog/${s.slug}`).join('\n')}`

  // PLATFORM-STAT TOKEN PROTOCOL applies — see persona.systemPrompt
  // (writer-personas.js) for the rules. Magnitudes shown alongside each
  // token so aux output (information_gain_summary, social_proof, etc.)
  // can reason about phrasing while emitting the live token literal.
  const platformBlock = platformIntelligence?.totalBrands
    ? `CRYPTOKILLER PLATFORM DATA (TOKENS — emit literal {{platform_stat:KEY}} in your prose; renderer substitutes live):
- {{platform_stat:total_brands_tracked}} scam brands tracked            [TOKEN — current ≈ ${platformIntelligence.totalBrands.toLocaleString()}]
- {{platform_stat:total_creatives_analyzed}} ad creatives analyzed      [TOKEN — current ≈ ${platformIntelligence.totalCreatives?.toLocaleString() || 'N/A'}]
- ${platformIntelligence.totalGeos || 'N/A'} countries                                                  [LITERAL — no aggregate token]
- avg scam score: {{platform_stat:avg_scam_score}}/100                  [TOKEN — current ≈ ${platformIntelligence.avgScamScore || 'N/A'}/100]
- celebrity-impersonation brands: {{platform_stat:total_brands_with_celebrity_abuse}}  [TOKEN — current ≈ ${platformIntelligence.celebrityAbuse || 'N/A'}]
- published reviews: {{platform_stat:total_brands_reviewed}}            [TOKEN — live count from Replit's reviews table]`
    : ''

  const sourcesBlock = (sourceLedger || [])
    .map((s, i) => `${i + 1}. [${s.type || 'unknown'}] ${s.title} — ${s.url}`)
    .join('\n')

  return `ARTICLE TOPIC: ${topic?.title || '(untitled)'}
TARGET KEYWORD: ${topic?.target_keyword || '(none)'}
WRITER: ${persona?.name || 'Author'}, ${persona?.title || ''}

ARTICLE SUMMARY:
${summary || '(none)'}

═══ ARTICLE BODY (use to extract entities, suggest links, place visuals) ═══

${sectionsBlock}

═══ ARTICLE FAQ ═══

${faqBlock}

═══ AVAILABLE SOURCES ═══

${sourcesBlock}

═══ INTERNAL LINK INVENTORY ═══

${slugsBlock}

${platformBlock}

Now produce the auxiliary fields. Read the body carefully — populate
mention_slugs from people/orgs ACTUALLY named in the body, place visual
placeholders where data or process explanation would benefit, and pick
internal_links that match concepts the body mentions. Return only the
JSON object.`
}

async function writeAux({
  topic,
  persona,
  sections,
  faq,
  summary,
  sourceLedger,
  publishedSlugs,
  platformIntelligence,
  currentYear = new Date().getFullYear(),
  timeouts = { haikuMs: 35000, sonnetMs: 45000 },
  maxTokens = 3000,
}) {
  const system = buildAuxSystem(persona, currentYear)
  const user = buildAuxUser({ topic, persona, sections, faq, summary, sourceLedger, publishedSlugs, platformIntelligence })
  const attempts = []

  // Validate aux output shape
  const validate = (parsed) => {
    if (!parsed) return false
    if (typeof parsed.not_for_you !== 'string') return false
    if (!Array.isArray(parsed.social_proof) || parsed.social_proof.length < 2) return false
    if (!Array.isArray(parsed.visual_placeholders) || parsed.visual_placeholders.length < 3) return false
    if (!Array.isArray(parsed.internal_links)) return false
    if (!parsed.schema_enrichment || typeof parsed.schema_enrichment !== 'object') return false
    return true
  }

  // Primary: Haiku
  const haikuStart = Date.now()
  try {
    const res = await callModel('claude-haiku', system, user, { maxTokens, timeoutMs: timeouts.haikuMs })
    const parsed = extractJSON(res.text)
    if (validate(parsed)) {
      attempts.push({
        stage: 'aux', label: 'haiku-primary', model: res.model, modelKey: 'claude-haiku',
        ok: true, durationMs: Date.now() - haikuStart,
        stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      })
      return { ok: true, ...parsed, attempts }
    }
    throw new Error('aux JSON failed validation (missing required field, not_for_you<string, social_proof<2, visual_placeholders<3, or schema_enrichment missing)')
  } catch (e) {
    attempts.push({
      stage: 'aux', label: 'haiku-primary', model: 'claude-haiku', modelKey: 'claude-haiku',
      ok: false, durationMs: Date.now() - haikuStart,
      error: String(e?.message || e || 'unknown error').slice(0, 1500),
    })
  }

  // Retry: Sonnet
  const sonnetStart = Date.now()
  try {
    const res = await callModel('claude-sonnet', system, user, { maxTokens, timeoutMs: timeouts.sonnetMs })
    const parsed = extractJSON(res.text)
    if (validate(parsed)) {
      attempts.push({
        stage: 'aux', label: 'sonnet-retry', model: res.model, modelKey: 'claude-sonnet',
        ok: true, durationMs: Date.now() - sonnetStart,
        stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      })
      return { ok: true, ...parsed, attempts }
    }
    throw new Error('aux JSON failed validation')
  } catch (e) {
    attempts.push({
      stage: 'aux', label: 'sonnet-retry', model: 'claude-sonnet', modelKey: 'claude-sonnet',
      ok: false, durationMs: Date.now() - sonnetStart,
      error: String(e?.message || e || 'unknown error').slice(0, 1500),
    })
  }

  // Deterministic fallback — minimum-viable aux fields so the article still ships
  const topicTitle = topic?.title || 'this topic'
  const targetKeyword = topic?.target_keyword || topicTitle
  attempts.push({
    stage: 'aux', label: 'deterministic-fallback',
    model: 'deterministic-fallback', modelKey: 'deterministic-fallback',
    ok: true, durationMs: 0,
    note: 'Both AI attempts failed; aux fields built from minimum viable shape',
  })
  return {
    ok: true,
    deterministicFallback: true,
    not_for_you: `This guide focuses on ${topicTitle} from a preventive standpoint. It does not cover funds-recovery procedures for victims who have already lost money — for that, separate guidance applies. It is also not aimed at advanced practitioners already running professional verification workflows; the framing here is for readers encountering ${targetKeyword} for the first time and deciding what to verify before they act.`,
    social_proof: [
      { type: 'study', source: 'FTC Consumer Sentinel', content: `Annual loss reports document the financial scale of ${targetKeyword}.`, attribution: `FTC Annual Report ${currentYear}` },
      { type: 'industry', source: 'FBI IC3', content: `Public complaint data and investigation summaries inform ${targetKeyword} typology.`, attribution: `FBI IC3 Annual Report ${currentYear}` },
    ],
    visual_placeholders: [
      `[DIAGRAM NEEDED: process diagram of how ${targetKeyword} unfolds | Alt: Annotated diagram showing the typical stages of a ${targetKeyword} encounter]`,
      `[CHART NEEDED: comparison of red flags by frequency | Alt: Horizontal bar chart showing how often each red flag appears across documented cases]`,
      `[IMAGE NEEDED: example of a verification step in action | Alt: Screenshot showing the verification technique applied to a real example]`,
    ],
    internal_links: [],
    schema_enrichment: {
      about_slugs: ['cryptocurrency-fraud'],
      mention_slugs: ['ftc', 'fbi', 'sec'],
      speakable_selectors: ['.key-takeaways'],
      citations: (sourceLedger || []).map((s) => ({
        name: s.title || 'Source',
        url: s.url || '',
        type: s.type === 'regulatory' ? 'GovernmentService' : s.type === 'government' ? 'Report' : 'WebPage',
        publisher: s.publisher || '',
        datePublished: s.accessed_date || '',
      })),
      dataset: null,
      primary_about_slug: 'cryptocurrency-fraud',
    },
    information_gain_summary: `Practical, action-oriented guidance on ${targetKeyword} backed by named regulatory sources.`,
    author_bio: `investigates cryptocurrency fraud at CryptoKiller.`,
    verify_tags_count: 0,
    reddit_test_passed: false,
    attempts,
  }
}

module.exports = { writeAux, buildAuxSystem, buildAuxUser }
