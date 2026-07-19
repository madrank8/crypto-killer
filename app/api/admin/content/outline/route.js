import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { verifySourceLedger } from '@/lib/source-verify'
import { formatBriefForPrompt } from '@/lib/topical-map/content-brief'

export const maxDuration = 120

/**
 * POST /api/admin/content/outline
 * SSE endpoint — generates an article outline (sections + FAQ) for a content draft.
 * Body: { content_id }
 *
 * Phase transition: empty → outline
 * Saves: title, headline, meta_description, sections (outline), faq, sources
 */

function outlineGeneratorPrompt({ topic, parentTopic, sourceLedger }) {
  const currentYear = new Date().getFullYear()
  const topicTitle = topic?.title || 'Untitled Topic'
  const topicKeyword = topic?.target_keyword || topicTitle
  const parentTitle = parentTopic?.title || ''

  const system = `You are a senior content strategist for Crypto Killer, a crypto scam investigation platform.
Your job is to create a detailed, editable article outline that the user can review and approve before full article generation.

Output a single JSON object. No markdown fences. No text before or after.

JSON shape:
{
  "title": "SEO title <= 60 chars",
  "headline": "H1 headline",
  "meta_description": "meta description <= 155 chars",
  "sections": [
    {
      "heading": "H2 section heading",
      "description": "2-3 sentence summary of what this section will cover",
      "target_word_count": 150,
      "key_points": ["point 1", "point 2", "point 3"]
    }
  ],
  "faq": [
    { "question": "natural search query", "answer_hint": "1-2 sentence hint of the answer direction" }
  ],
  "sources": [
    { "title": "source title", "url": "https://...", "type": "regulatory|government|news|technical|consumer_protection", "accessed_date": "YYYY-MM-DD" }
  ]
}

${topic?.content_type === 'discover'
  ? `Rules (GOOGLE DISCOVER MODE — this article is built for the Discover feed, NOT for search extraction; audit 2026-07-05 W5a):
- 2-3 sections ONLY. Snacking length — each section targets 200-280 words.
- DELAYED ANSWER: the first section builds the story/tension WITHOUT resolving the core question. Only the FINAL section pays it off. This is the exact inverse of the SEO answer-first rule — intentional for Discover engagement.
- DOPAMINE CLOSE: the final section's description must specify an emotionally satisfying payoff (revelation, twist, "what happened next").
- "title" is the HOOK title: curiosity-gap, ≤ 70 chars, NO question-format H2 requirement, NO keyword stuffing. It must make a feed-scroller stop.
- Also emit "seo_retitle_variant": a conventional keyword-led SEO title ≤ 60 chars (held in reserve for a later re-title once Discover traffic decays).
- 3-5 FAQ items max.
- YMYL guardrails still apply: no fabricated facts, safety actions where relevant, ${currentYear} context.
- Sources must be real, navigable URLs.`
  : `Rules:
- 5-8 sections total.
- Each section should target 120-260 words in the final article.
- At least 3 of the H2 headings MUST use question format (e.g., "How Do Scammers Fabricate Profits?" not "The Technology Scammers Use"). Critical for AI Overview extraction.
- 4-8 FAQ items.
- Include concrete, specific section headings (not generic).
- Focus on E-E-A-T: experience, expertise, authority, trust.
- YMYL content: include safety actions and reporting channels where relevant.
- Assume ${currentYear} context.
- BANNED phrases: "In today's rapidly evolving", "It's important to note", "Let's dive in", "landscape", "crucial", "comprehensive", "robust", "deep dive", "delve", "journey"
- Sources must be real, navigable URLs.`}`

  // Topical-map brief: turns the topic's map metadata (content_format, schema_type,
  // node_function, PAA questions, AIO risk, url_path, …) into explicit production
  // directives. Empty string when the topic carries no such metadata (additive).
  // Suppressed in Discover mode: the brief is answer-first/extraction-forward, the
  // exact inverse of Discover's delayed-answer, no-question-format H2 strategy — so
  // injecting it there would fight the mode's own rules.
  const mapBrief = topic?.content_type === 'discover' ? '' : formatBriefForPrompt(topic, { parentTopic })

  const user = `Create an article outline for:

TOPIC: ${topicTitle}
PRIMARY KEYWORD: ${topicKeyword}
${parentTitle ? `PARENT PILLAR/CLUSTER: ${parentTitle}` : ''}
${mapBrief ? `\n${mapBrief}\n` : ''}
TOPIC DETAILS:
${JSON.stringify(topic || {}, null, 2)}

${parentTopic ? `PARENT TOPIC:\n${JSON.stringify(parentTopic, null, 2)}` : ''}

SOURCE LEDGER (verified sources to reference):
${(sourceLedger || []).map((s, i) => `${i + 1}. [${s.type}] ${s.title} — ${s.url}`).join('\n') || '(none — include your own verified sources)'}

Generate the outline JSON now.`

  return { system, user }
}

function sourceResearchPrompt(topic, currentDate) {
  const currentYear = new Date().getFullYear()
  return {
    system: `You are a source researcher for topical crypto scam safety content.
Return ONLY valid JSON with this shape:
{
  "sources": [
    { "title": "...", "url": "https://...", "type": "regulatory|government|news|technical|consumer_protection|academic|industry_study", "accessed_date": "YYYY-MM-DD", "publication_year": 2025, "temporal": "ESTABLISHED|RECENT" }
  ]
}
Rules:
- URLs must be real and navigable. Never invent URLs.
- TEMPORAL DIVERSITY: Sources MUST span at least 2 different publication_year values.
  * At least 1 source from ${currentYear} (current year) for semantic freshness.
  * At least 1 foundational source from 2020-2023.
- Prefer regulatory/government sources first (SEC, FTC, FBI IC3, FCA, CFPB).
- accessed_date: set to the source's ACTUAL publication date (YYYY-MM-DD). Each source MUST have a DIFFERENT date.
- No markdown fences.`,
    user: `Research credible sources for this topic:
Title: ${topic.title}
Keyword: ${topic.target_keyword || topic.title}
Type: ${topic.content_type || 'educational'}

Return 4-8 sources. Each source MUST have a unique accessed_date matching its real publication date.`,
  }
}

function fallbackSourceLedger(topicKeyword, currentDate) {
  return [
    { title: 'FCA ScamSmart Warning List', url: 'https://www.fca.org.uk/scamsmart/warning-list', type: 'regulatory', accessed_date: currentDate },
    { title: 'FTC Report Fraud', url: 'https://reportfraud.ftc.gov/', type: 'government', accessed_date: currentDate },
    { title: 'FBI IC3', url: 'https://www.ic3.gov/', type: 'government', accessed_date: currentDate },
    { title: `Consumer Protection References for ${topicKeyword}`, url: 'https://www.scamadviser.com/', type: 'consumer_protection', accessed_date: currentDate },
  ]
}

function buildDeterministicOutline(topic, parentTopic, sourceLedger) {
  const topicTitle = topic?.title || 'Crypto Scam Guide'
  const keyword = topic?.target_keyword || topicTitle

  return {
    title: `${topicTitle}: Safety Guide`,
    headline: `${topicTitle} — How to Verify Claims and Avoid Losses`,
    meta_description: `Practical safety guide for ${keyword}. Learn red flags, verification steps, and what to do if targeted.`,
    sections: [
      { heading: `What ${keyword} typically looks like`, description: `Overview of how ${keyword} scams operate, common patterns, pressure tactics, and social engineering methods used.`, target_word_count: 180, key_points: ['Common patterns and tactics', 'Social engineering methods', 'Pressure and urgency signals'] },
      { heading: 'Core red flags to check first', description: 'Objective verification checks: registration claims, domain age, support quality, withdrawal terms, and guaranteed return promises.', target_word_count: 160, key_points: ['Registration and licensing checks', 'Domain and company verification', 'Withdrawal term analysis'] },
      { heading: 'Step-by-step verification workflow', description: 'A structured sequence for verifying legitimacy before depositing: entity checks, regulator records, WHOIS, complaints, support testing.', target_word_count: 200, key_points: ['Legal entity verification', 'Regulator database lookup', 'Independent complaint review'] },
      { heading: 'What to do if you already sent funds', description: 'Evidence preservation, payment provider notification, official reporting channels, and avoiding recovery scams.', target_word_count: 180, key_points: ['Evidence preservation steps', 'Payment provider notification', 'Official reporting channels'] },
      { heading: 'Prevention habits for future decisions', description: 'Building sustainable safety habits: cooling-off periods, independent verification, risk limits, and checklists.', target_word_count: 150, key_points: ['Cooling-off time before deposits', 'Independent verification routine', 'Risk limit enforcement'] },
    ],
    faq: [
      { question: `Is ${keyword} always a scam?`, answer_hint: 'Not always, but any offer with pressure tactics, guaranteed returns, or unclear legal identity is high risk.' },
      { question: 'What is the first thing I should verify?', answer_hint: 'Legal entity and regulatory claims first, then domain history and withdrawal terms.' },
      { question: 'Can I recover funds after being scammed?', answer_hint: 'Depends on payment method and reporting speed. Collect evidence and file official reports immediately.' },
      { question: 'How should families help a victim?', answer_hint: 'Focus on evidence capture, fast reporting, emotional support, and avoiding blame.' },
    ],
    sources: sourceLedger || [],
  }
}

export async function POST(request) {
  try {
    verifyAdmin(request)

    const body = await request.json()
    const contentId = body?.content_id
    if (!contentId) {
      return Response.json({ error: 'content_id is required' }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          send({ step: 'init', progress: 5, message: 'Loading content and topic data...' })

          // Load content + topic
          const contentRows = await supaFetch(`/content?id=eq.${contentId}&select=*&limit=1`)
          const content = Array.isArray(contentRows) ? contentRows[0] : null
          if (!content) throw new Error('Content not found')

          let topic = null
          if (content.topic_id) {
            const topicRows = await supaFetch(`/topics?id=eq.${content.topic_id}&select=*&limit=1`)
            topic = Array.isArray(topicRows) ? topicRows[0] : null
          }
          if (!topic) throw new Error('Linked topic not found')

          let parentTopic = null
          if (topic.parent_id) {
            const parentRows = await supaFetch(`/topics?id=eq.${topic.parent_id}&select=id,title,target_keyword,content_type&limit=1`)
            parentTopic = Array.isArray(parentRows) ? parentRows[0] : null
          }

          // Phase 1: Source research
          send({ step: 'research', progress: 18, message: 'Researching verified sources...' })

          const currentDate = new Date().toISOString().slice(0, 10)
          let sourceLedger = []
          try {
            const srcPrompt = sourceResearchPrompt(topic, currentDate)
            const srcResult = await callModel(
              getAvailableModels().google ? 'gemini-pro' : 'claude-haiku',
              srcPrompt.system,
              srcPrompt.user,
              { searchGrounding: getAvailableModels().google, timeoutMs: 45000 }
            )
            const parsed = extractJSON(srcResult.text)
            sourceLedger = Array.isArray(parsed?.sources) ? parsed.sources : []
          } catch {
            sourceLedger = fallbackSourceLedger(topic.target_keyword || topic.title, currentDate)
          }

          if (sourceLedger.length === 0) {
            sourceLedger = fallbackSourceLedger(topic.target_keyword || topic.title, currentDate)
          }

          // Phase 1.5: Deterministic URL verification (lib/source-verify.js).
          // The researcher self-asserts URLs; HEAD/GET-check them here so the
          // outline + downstream writers never cite a dead or hallucinated
          // source (P0-1, content-pipeline skill audit). Best-effort: an
          // empty post-verification ledger falls back to the static set.
          try {
            const { verified, dropped } = await verifySourceLedger(sourceLedger)
            if (dropped.length > 0) {
              console.warn('[outline] dropped dead/unverifiable sources:', JSON.stringify(dropped.map((d) => ({ url: d.source.url, reason: d.reason }))))
              send({ step: 'research_verified', progress: 22, message: `Verified sources: ${verified.length} live, ${dropped.length} dead URL${dropped.length === 1 ? '' : 's'} dropped` })
            }
            sourceLedger = verified.length > 0
              ? verified
              : fallbackSourceLedger(topic.target_keyword || topic.title, currentDate)
          } catch (verifyErr) {
            console.error('[outline] source verification failed (non-fatal):', verifyErr.message)
          }

          // Phase 2: Generate outline with Claude Sonnet (fast)
          send({ step: 'outline', progress: 40, message: 'Generating article outline with Claude Sonnet...' })

          let outline = null
          let outlineModel = 'deterministic-fallback'

          const prompt = outlineGeneratorPrompt({ topic, parentTopic, sourceLedger })

          const attempts = [
            { model: 'claude-sonnet', timeoutMs: 90000, label: 'sonnet-primary' },
            { model: 'claude-haiku', timeoutMs: 60000, label: 'haiku-fallback' },
            ...(getAvailableModels().google
              ? [{ model: 'gemini-pro', timeoutMs: 45000, jsonMode: true, label: 'gemini-fallback' }]
              : []),
          ]

          for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i]
            if (i > 0) {
              send({ step: 'outline', progress: 50 + i * 8, message: `Retrying outline (${attempt.label})...` })
            }
            try {
              const res = await callModel(attempt.model, prompt.system, prompt.user, {
                maxTokens: 4096,
                timeoutMs: attempt.timeoutMs,
                ...(attempt.jsonMode ? { jsonMode: true } : {}),
              })
              outline = extractJSON(res.text)
              outlineModel = res.resolvedModel || attempt.model
              break
            } catch (e) {
              console.error(`Outline attempt failed [${attempt.label}]:`, e.message)
            }
          }

          if (!outline || !outline.sections || outline.sections.length === 0) {
            send({ step: 'outline', progress: 70, message: 'AI outline timed out, using structured fallback...' })
            outline = buildDeterministicOutline(topic, parentTopic, sourceLedger)
            outlineModel = 'deterministic-fallback'
          }

          // Phase 3: Save outline to content record
          send({ step: 'saving', progress: 85, message: 'Saving outline...' })

          await supaFetch(`/content?id=eq.${contentId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              title: outline.title || content.title,
              headline: outline.headline || content.headline,
              meta_description: outline.meta_description || content.meta_description,
              sections: outline.sections || [],
              faq: (outline.faq || []).map(f => ({
                question: f.question,
                answer: f.answer_hint || f.answer || '',
              })),
              sources: outline.sources || sourceLedger,
              ai_model: outlineModel,
              // W5a (Discover lane): the held-in-reserve SEO re-title emitted
              // in discover mode lands in alternative_headline (fill also
              // derives one for non-discover articles, so only set when the
              // outline actually produced it).
              ...(outline.seo_retitle_variant
                ? { alternative_headline: String(outline.seo_retitle_variant).slice(0, 110) }
                : {}),
              updated_at: new Date().toISOString(),
            }),
          })

          send({
            step: 'done',
            progress: 100,
            message: 'Outline generated — review and edit before generating the full article.',
            result: {
              content_id: contentId,
              sections: outline.sections?.length || 0,
              faq: outline.faq?.length || 0,
              model: outlineModel,
            },
          })
        } catch (err) {
          send({ step: 'error', progress: 0, message: err.message, error: true })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
