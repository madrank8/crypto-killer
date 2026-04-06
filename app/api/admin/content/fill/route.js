import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { topicalArticleWriterPrompt } from '@/lib/content-prompts'
import { qualityAuditorPrompt } from '@/lib/review-prompts'

export const maxDuration = 300

/**
 * POST /api/admin/content/fill
 * SSE endpoint — generates the full article body from an approved outline.
 * Body: { content_id }
 *
 * Phase transition: outline → article (full_article populated)
 * Uses the approved sections/faq as the structural skeleton.
 */

function sectionsToHtml(sections = []) {
  return (sections || [])
    .map((s) => `<h2>${s.heading || 'Section'}</h2><p>${String(s.body || '').replace(/\n+/g, '<br/>')}</p>`)
    .join('\n\n')
}

function buildDeterministicArticle(topic, parentTopic, sections, faq, sourceLedger) {
  const topicTitle = topic?.title || 'Crypto Scam Guide'
  const keyword = topic?.target_keyword || topicTitle
  const parentTitle = parentTopic?.title

  // Use the approved outline sections, fill body from description + key_points
  const filledSections = (sections || []).map((s) => ({
    heading: s.heading,
    body: [
      s.description || '',
      ...(s.key_points || []).map((kp) => `${kp}.`),
      parentTitle ? `This topic relates to the broader area of "${parentTitle}".` : '',
    ]
      .filter(Boolean)
      .join(' '),
  }))

  const filledFaq = (faq || []).map((f) => ({
    question: f.question,
    answer: f.answer || f.answer_hint || `For questions about ${keyword}, verify claims independently and consult official sources before taking action.`,
  }))

  return {
    title: topic?.title || `${topicTitle}: Safety Guide`,
    headline: topic?.headline || `${topicTitle} — How to Verify Claims and Avoid Losses`,
    meta_description: `Practical safety guide for ${keyword}. Learn red flags, verification steps, and what to do if targeted.`,
    summary: `This guide explains how ${keyword} scams typically operate, how to verify claims before sending money, and what steps to take if you were targeted.`,
    sections: filledSections,
    faq: filledFaq,
    sources: sourceLedger || [],
    internal_links: [
      { anchor_text: 'how crypto scam funnels work', target_topic: 'scam mechanics', context: 'Explaining persuasion stages.' },
      { anchor_text: 'crypto scam recovery checklist', target_topic: 'recovery', context: 'Post-loss action sections.' },
    ],
    not_for_you: `This guide may not apply if you are using a regulated, licensed exchange with verified withdrawal history. It also does not cover disputes with legitimate platforms over fees or service quality — only suspected fraud.`,
    verify_tags_count: 0,
    reddit_test_passed: false,
    information_gain_summary: 'Deterministic fallback — no unique information gain analysis available.',
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
          send({ step: 'init', progress: 5, message: 'Loading content with approved outline...' })

          // Load content
          const contentRows = await supaFetch(`/content?id=eq.${contentId}&select=*&limit=1`)
          const content = Array.isArray(contentRows) ? contentRows[0] : null
          if (!content) throw new Error('Content not found')

          const sections = content.sections
          if (!Array.isArray(sections) || sections.length === 0) {
            throw new Error('No outline found. Generate an outline first.')
          }

          // Load topic + parent
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

          // Load ICP data
          let icpData = {}
          try {
            const { readFileSync } = await import('fs')
            const pathMod = await import('path')
            const icpPath = pathMod.join(process.cwd(), 'data', 'icp.json')
            icpData = JSON.parse(readFileSync(icpPath, 'utf8'))
          } catch {
            icpData = {}
          }

          const sourceLedger = content.sources || []

          // Build an enhanced topic object that includes the approved outline
          const enhancedTopic = {
            ...topic,
            // Pass outline context so the writer knows what sections to produce
            approved_outline: sections.map((s) => ({
              heading: s.heading,
              description: s.description || '',
              target_word_count: s.target_word_count || 180,
              key_points: s.key_points || [],
            })),
            approved_faq: content.faq || [],
          }

          send({ step: 'writing', progress: 25, message: 'Writing full article with Claude Opus...' })

          // Use the existing writer prompt, augmented with outline structure
          const writerPrompt = topicalArticleWriterPrompt({
            topic: enhancedTopic,
            parentTopic,
            sourceLedger,
            icpData,
          })

          // Augment the user prompt with the approved outline
          const outlineBlock = sections
            .map((s, i) => {
              const kp = (s.key_points || []).map((p) => `  - ${p}`).join('\n')
              return `${i + 1}. ${s.heading} (~${s.target_word_count || 180} words)\n   ${s.description || ''}\n${kp}`
            })
            .join('\n\n')

          const faqBlock = (content.faq || [])
            .map((f, i) => `${i + 1}. Q: ${f.question}\n   Hint: ${f.answer || f.answer_hint || ''}`)
            .join('\n')

          const augmentedUserPrompt = `${writerPrompt.user}

APPROVED OUTLINE (you MUST follow this structure exactly):
${outlineBlock}

APPROVED FAQ TOPICS (expand each into a full answer):
${faqBlock}

CRITICAL: Follow the outline section order and headings exactly. Expand each section to the target word count. Write full FAQ answers (40-90 words each).`

          let article = null
          let writerModelUsed = 'deterministic-fallback'

          const available = getAvailableModels()
          const writeAttempts = [
            { model: 'claude-opus', user: augmentedUserPrompt, timeoutMs: 120000, label: 'opus-primary' },
            { model: 'claude-sonnet', user: `${augmentedUserPrompt}\n\nReturn compact JSON only.`, timeoutMs: 75000, label: 'sonnet-compact' },
            ...(available.google
              ? [{ model: 'gemini-pro', user: `${augmentedUserPrompt}\n\nReturn compact JSON only.`, timeoutMs: 60000, jsonMode: true, label: 'gemini-fallback' }]
              : []),
          ]

          for (let i = 0; i < writeAttempts.length; i++) {
            const attempt = writeAttempts[i]
            if (i > 0) {
              send({ step: 'writing', progress: 35 + i * 10, message: `Retrying writer (${attempt.label})...` })
            }
            try {
              const res = await callModel(attempt.model, writerPrompt.system, attempt.user, {
                maxTokens: 8192,
                timeoutMs: attempt.timeoutMs,
                ...(attempt.jsonMode ? { jsonMode: true } : {}),
              })
              article = extractJSON(res.text)
              writerModelUsed = res.resolvedModel || attempt.model
              break
            } catch (e) {
              console.error(`Writer attempt failed [${attempt.label}]:`, e.message)
            }
          }

          if (!article || !article.title) {
            send({ step: 'writing', progress: 60, message: 'AI writer timed out, using deterministic fallback...' })
            article = buildDeterministicArticle(topic, parentTopic, sections, content.faq, sourceLedger)
            writerModelUsed = 'deterministic-fallback'
          }

          // Quality audit
          send({ step: 'audit', progress: 70, message: 'Running quality audit...' })

          let audit = null
          try {
            const auditPrompt = qualityAuditorPrompt()
            const auditMsg = auditPrompt.userTemplate(
              article,
              {
                name: topic.title,
                scam_score: 0,
                total_creatives: 0,
                total_geos: 0,
                total_celebrities: 0,
                velocity_7d: 0,
                first_seen_at: null,
                last_seen_at: null,
              },
              sourceLedger,
              {}
            )
            const auditResult = await callModel('gpt-4o', auditPrompt.system, auditMsg, {
              jsonMode: true,
              timeoutMs: 45000,
            })
            audit = extractJSON(auditResult.text)
          } catch {
            audit = null
          }

          // Save full article
          send({ step: 'saving', progress: 85, message: 'Saving full article...' })

          const articleSections = Array.isArray(article.sections) ? article.sections : sections
          const articleFaq = Array.isArray(article.faq) ? article.faq : content.faq || []
          const fullArticle = sectionsToHtml(articleSections)
          const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length

          await supaFetch(`/content?id=eq.${contentId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              title: article.title || content.title,
              headline: article.headline || content.headline,
              meta_description: article.meta_description || content.meta_description,
              summary: article.summary || content.summary,
              full_article: fullArticle,
              sections: articleSections,
              faq: articleFaq,
              sources: article.sources || sourceLedger,
              internal_links: article.internal_links || content.internal_links || [],
              word_count: wordCount,
              ai_model: writerModelUsed,
              ai_audit: audit,
              not_for_you: article.not_for_you || content.not_for_you || null,
              verify_tags_count: article.verify_tags_count || 0,
              reddit_test_passed: article.reddit_test_passed || false,
              information_gain_summary: article.information_gain_summary || null,
              updated_at: new Date().toISOString(),
            }),
          })

          send({
            step: 'done',
            progress: 100,
            message: 'Article generated successfully — review and publish when ready.',
            result: {
              content_id: contentId,
              word_count: wordCount,
              model: writerModelUsed,
              has_audit: !!audit,
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
