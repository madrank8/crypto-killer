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

          const writeResult = await callModel('claude-opus', writerPrompt.system, writerPrompt.user, {
            maxTokens: 8192,
            timeoutMs: 90000,
          })

          let article = null
          try {
            article = extractJSON(writeResult.text)
          } catch {
            // compact fallback retry
            const retryResult = await callModel('claude-sonnet', writerPrompt.system, `${writerPrompt.user}\n\nReturn compact JSON.`, {
              maxTokens: 8192,
              timeoutMs: 90000,
            })
            article = extractJSON(retryResult.text)
          }

          if (!article || !article.title) {
            throw new Error('Writer did not return valid article JSON')
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
              ai_model: writeResult.resolvedModel || 'claude-opus',
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

