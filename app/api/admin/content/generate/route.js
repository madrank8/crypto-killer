import { readFileSync } from 'fs'
import path from 'path'

import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { topicalArticleWriterPrompt } from '@/lib/content-prompts'
import { qualityAuditorPrompt } from '@/lib/review-prompts'

export const maxDuration = 300

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180) || 'guide'
}

async function ensureUniqueContentSlug(base) {
  const cleanBase = slugify(base)
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? cleanBase : `${cleanBase}-${attempt + 1}`
    const rows = await supaFetch(`/content?slug=eq.${candidate}&select=id&limit=1`)
    if (!Array.isArray(rows) || rows.length === 0) return candidate
  }
  return `${cleanBase}-${Date.now()}`
}

function sectionsToHtml(sections = []) {
  return (sections || [])
    .map((s) => `<h2>${s.heading || 'Section'}</h2><p>${String(s.body || '').replace(/\n+/g, '<br/>')}</p>`)
    .join('\n\n')
}

function fallbackSourceLedger(topicKeyword, currentDate) {
  return [
    {
      title: 'FCA ScamSmart Warning List',
      url: 'https://www.fca.org.uk/scamsmart/warning-list',
      type: 'regulatory',
      accessed_date: currentDate,
    },
    {
      title: 'FTC Report Fraud',
      url: 'https://reportfraud.ftc.gov/',
      type: 'government',
      accessed_date: currentDate,
    },
    {
      title: 'FBI IC3',
      url: 'https://www.ic3.gov/',
      type: 'government',
      accessed_date: currentDate,
    },
    {
      title: `Consumer Protection References for ${topicKeyword}`,
      url: 'https://www.scamadviser.com/',
      type: 'consumer_protection',
      accessed_date: currentDate,
    },
  ]
}

function sourceResearchPrompt(topic, currentDate) {
  return {
    system: `You are a source researcher for topical crypto scam safety content.
Return ONLY valid JSON with this shape:
{
  "sources": [
    { "title": "...", "url": "https://...", "type": "regulatory|government|news|technical|consumer_protection", "accessed_date": "${currentDate}" }
  ]
}
Rules:
- URLs must be real and navigable.
- Prefer regulatory/government sources first.
- No markdown fences.`,
    user: `Research credible sources for this topic:
${JSON.stringify(topic, null, 2)}

Return 4-8 sources.`,
  }
}

function buildDeterministicArticle(topic, parentTopic, sourceLedger) {
  const topicTitle = topic?.title || 'Crypto Scam Guide'
  const keyword = topic?.target_keyword || topicTitle
  const parentTitle = parentTopic?.title
  const parentLine = parentTitle ? `This topic sits under "${parentTitle}".` : ''

  return {
    title: `${topicTitle}: Safety Guide`,
    headline: `${topicTitle} — How to Verify Claims and Avoid Losses`,
    meta_description: `Practical safety guide for ${keyword}. Learn red flags, verification steps, and what to do if targeted.`,
    summary:
      `This guide explains how ${keyword} scams typically operate, how to verify claims before sending money, and what steps to take if you were targeted.`,
    sections: [
      {
        heading: `What ${keyword} usually looks like`,
        body:
          `${keyword} scams often combine urgency, social proof, and technical jargon to pressure a fast decision. Common patterns include guaranteed return claims, celebrity or authority impersonation, and direct messages that push users off-platform. ${parentLine}`.trim(),
      },
      {
        heading: 'Core red flags to check first',
        body:
          'Start with objective checks: registration claims, domain age, support contact quality, and withdrawal terms. If the offer promises fixed returns, requires immediate deposits, or avoids transparent legal/company details, treat it as high risk.',
      },
      {
        heading: 'Verification workflow before depositing',
        body:
          'Use a simple sequence: verify legal entity details, confirm regulator records where relevant, inspect domain/WHOIS history, review independent complaint patterns, and test support responses with concrete questions. If multiple checks fail, stop immediately.',
      },
      {
        heading: 'What to do if you already sent funds',
        body:
          'Preserve evidence (wallet addresses, transaction IDs, chats, screenshots), notify your payment provider/bank quickly, and report to official channels. Avoid anyone asking for an upfront recovery fee; follow documented reporting paths first.',
      },
      {
        heading: 'Prevention habits for future decisions',
        body:
          'Use cooling-off time, independent verification, and strict risk limits. Never rely on social media proof alone. Keep a checklist and require all checks to pass before any transfer. When uncertain, default to not sending funds.',
      },
    ],
    faq: [
      {
        question: `Is ${keyword} always a scam?`,
        answer:
          'Not every mention of a keyword is automatically fraudulent, but any offer with pressure tactics, guaranteed returns, or unclear legal identity should be treated as high risk until fully verified.',
      },
      {
        question: 'What is the first thing I should verify?',
        answer:
          'Verify legal entity and regulatory claims first, then validate domain history and withdrawal terms. If these are vague, inconsistent, or missing, do not deposit.',
      },
      {
        question: 'Can I recover funds after being scammed?',
        answer:
          'Recovery depends on payment method and speed of reporting. Collect evidence immediately, contact your provider, and file official reports. Avoid third parties demanding upfront recovery payments.',
      },
      {
        question: 'How should families help a victim?',
        answer:
          'Focus on evidence capture, fast reporting, and emotional support. Avoid blame. Help the victim document timelines and freeze further payments while official complaints are filed.',
      },
    ],
    sources: sourceLedger || [],
    internal_links: [
      {
        anchor_text: 'how crypto scam funnels work',
        target_topic: 'scam mechanics',
        context: 'Use this when explaining persuasion stages and conversion tactics.',
      },
      {
        anchor_text: 'crypto scam recovery checklist',
        target_topic: 'recovery',
        context: 'Use this in post-loss action sections.',
      },
    ],
  }
}

export async function POST(request) {
  try {
    verifyAdmin(request)

    const body = await request.json()
    const topicId = body?.topic_id
    if (!topicId) {
      return Response.json({ error: 'topic_id is required' }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          send({ step: 'init', progress: 5, message: 'Loading topic intelligence...' })

          const topicRows = await supaFetch(`/topics?id=eq.${topicId}&select=*&limit=1`)
          const topic = Array.isArray(topicRows) ? topicRows[0] : null
          if (!topic) throw new Error('Topic not found')
          if (topic.content_type === 'brand_review') {
            throw new Error('Brand review topics must use the existing review pipeline')
          }

          const parentRows = topic.parent_id
            ? await supaFetch(`/topics?id=eq.${topic.parent_id}&select=id,title,target_keyword,content_type&limit=1`)
            : []
          const parentTopic = Array.isArray(parentRows) ? parentRows[0] : null

          const currentDate = new Date().toISOString().slice(0, 10)
          let icpData = {}
          try {
            const icpPath = path.join(process.cwd(), 'data', 'icp.json')
            icpData = JSON.parse(readFileSync(icpPath, 'utf8'))
          } catch {
            icpData = {}
          }

          send({ step: 'research', progress: 18, message: 'Researching verified sources...' })

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

          send({ step: 'writing', progress: 45, message: 'Writing SEO article with Claude...' })

          const writerPrompt = topicalArticleWriterPrompt({
            topic,
            parentTopic,
            sourceLedger,
            icpData,
          })

          let article = null
          let writerModelUsed = 'deterministic-fallback'

          const available = getAvailableModels()
          const writeAttempts = [
            { model: 'claude-opus', user: writerPrompt.user, timeoutMs: 60000, label: 'opus-primary' },
            { model: 'claude-sonnet', user: `${writerPrompt.user}\n\nReturn compact JSON only.`, timeoutMs: 45000, label: 'sonnet-compact' },
            ...(available.google
              ? [{ model: 'gemini-pro', user: `${writerPrompt.user}\n\nReturn compact JSON only.`, timeoutMs: 45000, jsonMode: true, label: 'gemini-fallback' }]
              : []),
          ]

          for (let i = 0; i < writeAttempts.length; i++) {
            const attempt = writeAttempts[i]
            if (i > 0) {
              send({
                step: 'writing',
                progress: 52 + i * 6,
                message: `Retrying writer (${attempt.label})...`,
              })
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
            send({
              step: 'writing',
              progress: 70,
              message: 'AI writer timed out, using deterministic fallback draft...',
            })
            article = buildDeterministicArticle(topic, parentTopic, sourceLedger)
            writerModelUsed = 'deterministic-fallback'
          }

          send({ step: 'audit', progress: 72, message: 'Running quality audit...' })

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

          send({ step: 'saving', progress: 84, message: 'Saving draft content...' })

          const slug = await ensureUniqueContentSlug(article.slug || article.title || topic.title)
          const sections = Array.isArray(article.sections) ? article.sections : []
          const faq = Array.isArray(article.faq) ? article.faq : []
          const fullArticle = sectionsToHtml(sections)
          const wordCount = fullArticle.split(/\s+/).filter(Boolean).length

          const inserted = await supaFetch('/content?select=id,slug', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              topic_id: topic.id,
              content_type: topic.content_type || 'guide',
              title: article.title || topic.title,
              headline: article.headline || article.title || topic.title,
              slug,
              meta_description: article.meta_description || null,
              summary: article.summary || null,
              full_article: fullArticle,
              sections,
              faq,
              internal_links: article.internal_links || [],
              sources: article.sources || sourceLedger,
              word_count: wordCount,
              status: 'draft',
              ai_model: writerModelUsed,
              ai_audit: audit,
              updated_at: new Date().toISOString(),
            }),
          })
          const content = Array.isArray(inserted) ? inserted[0] : inserted
          if (!content?.id) throw new Error('Failed to insert content')

          await supaFetch(`/topics?id=eq.${topic.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              content_id: content.id,
              content_status: 'draft',
              updated_at: new Date().toISOString(),
            }),
          })

          send({
            step: 'done',
            progress: 100,
            message: 'Draft article generated successfully.',
            result: {
              content_id: content.id,
              slug: content.slug,
              topic_id: topic.id,
              word_count: wordCount,
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

