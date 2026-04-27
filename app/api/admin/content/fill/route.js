import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { qualityAuditorPrompt } from '@/lib/review-prompts'
import { processVisuals, processVisualsSections, stripVerifyTags } from '@/lib/visual-generator'
import { generateArticleImages, injectImagesIntoHtml } from '@/lib/images'
import { selectPersona, getPersonaPrompts, getPersonaMetadata } from '@/lib/writer-personas'

export const maxDuration = 300

/**
 * POST /api/admin/content/fill
 * SSE endpoint — generates the full article body from an approved outline.
 * Body: { content_id }
 *
 * Phase transition: outline → article (full_article populated)
 * Uses the approved sections/faq as the structural skeleton.
 * 
 * PERSONA INTEGRATION:
 * - Randomly selects one of three writer personas (Webb/Nair/Ortiz)
 * - Each persona has distinct voice, system prompt, and user prompt template
 * - Persona metadata is tracked in ai_audit for article provenance
 */

/**
 * Apply inline formatting: VERIFY tags, bold, italic, inline code.
 */
function applyInlineFormatting(text) {
  return text
    .replace(/\{\{VERIFY:\s*(.+?)\s*\|\s*(.+?)\}\}/g,
      '<span class="verify-tag" data-verify="true" title="$2">[$1]</span>')
    .replace(/\{\{RESEARCH NEEDED:\s*(.+?)\}\}/g,
      '<span class="research-tag" data-verify="research">[$1]</span>')
    .replace(/\{\{SOURCE NEEDED:\s*(.+?)\}\}/g,
      '<span class="source-tag" data-verify="source">[$1]</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

/**
 * Convert markdown-flavored section body into rich HTML.
 * Parses: tables, unordered/ordered lists, callout boxes, blockquotes,
 * bold/italic, inline code, and {{VERIFY}} tags. Falls back to <p> for plain text.
 */
function bodyToHtml(body) {
  if (!body) return ''
  const text = String(body)

  // Split into blocks on double newlines
  const blocks = text.split(/\n{2,}/).filter(b => b.trim())
  const htmlParts = []

  for (const block of blocks) {
    const trimmed = block.trim()

    // ── H3 subheading: ### heading text ──
    const h3Match = trimmed.match(/^###\s+(.+)$/)
    if (h3Match) {
      htmlParts.push(`<h3>${applyInlineFormatting(h3Match[1].trim())}</h3>`)
      continue
    }

    // ── Callout boxes: {{WARNING: text}} or {{TIP: text}} ──
    const calloutMatch = trimmed.match(/^\{\{(WARNING|TIP|NOTE|CAUTION):\s*([\s\S]+?)\}\}$/i)
    if (calloutMatch) {
      const type = calloutMatch[1].toLowerCase()
      const content = applyInlineFormatting(calloutMatch[2].trim())
      htmlParts.push(`<div class="callout callout-${type}"><strong>${calloutMatch[1].charAt(0).toUpperCase() + calloutMatch[1].slice(1).toLowerCase()}:</strong> ${content}</div>`)
      continue
    }

    // ── Markdown table: lines starting with | ──
    const lines = trimmed.split('\n')
    if (lines.length >= 2 && lines[0].trim().startsWith('|') && lines[1].trim().match(/^\|[\s:|-]+\|$/)) {
      const parseRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const headers = parseRow(lines[0])
      const dataRows = lines.slice(2).filter(l => l.trim().startsWith('|'))
      let table = '<div class="table-wrapper"><table>\n<thead><tr>'
      headers.forEach(h => { table += `<th>${applyInlineFormatting(h)}</th>` })
      table += '</tr></thead>\n<tbody>'
      dataRows.forEach(row => {
        const cells = parseRow(row)
        table += '\n<tr>'
        cells.forEach(c => { table += `<td>${applyInlineFormatting(c)}</td>` })
        table += '</tr>'
      })
      table += '\n</tbody></table></div>'
      htmlParts.push(table)
      continue
    }

    // ── Blockquote: lines starting with > ──
    if (lines[0].trim().startsWith('>')) {
      const quoteLines = lines.map(l => l.trim().replace(/^>\s?/, ''))
      let attribution = ''
      let quoteText = quoteLines
      if (quoteLines.length > 1 && /^(—|--|-)/.test(quoteLines[quoteLines.length - 1])) {
        attribution = quoteLines[quoteLines.length - 1].replace(/^(—|--|-)\s*/, '')
        quoteText = quoteLines.slice(0, -1)
      }
      let bq = `<blockquote class="expert-quote"><p>${applyInlineFormatting(quoteText.join(' '))}</p>`
      if (attribution) bq += `\n<cite>— ${applyInlineFormatting(attribution)}</cite>`
      bq += '</blockquote>'
      htmlParts.push(bq)
      continue
    }

    // ── Unordered list: lines starting with - or * ──
    if (lines.every(l => /^\s*[-*]\s+/.test(l) || !l.trim())) {
      const items = lines.filter(l => l.trim()).map(l => l.trim().replace(/^[-*]\s+/, ''))
      htmlParts.push(`<ul>\n${items.map(i => `<li>${applyInlineFormatting(i)}</li>`).join('\n')}\n</ul>`)
      continue
    }

    // ── Ordered list: lines starting with 1. 2. etc ──
    if (lines.every(l => /^\s*\d+\.\s+/.test(l) || !l.trim())) {
      const items = lines.filter(l => l.trim()).map(l => l.trim().replace(/^\d+\.\s+/, ''))
      htmlParts.push(`<ol>\n${items.map(i => `<li>${applyInlineFormatting(i)}</li>`).join('\n')}\n</ol>`)
      continue
    }

    // ── Default: paragraph ──
    let html = trimmed.replace(/\n/g, '<br/>')
    html = applyInlineFormatting(html)
    if (/<(figure|div|img|table|blockquote)\b/i.test(html)) {
      htmlParts.push(html)
    } else {
      htmlParts.push(`<p>${html}</p>`)
    }
  }

  return htmlParts.join('\n')
}

/**
 * Build full HTML from structured article data.
 * Renders: Summary → Key Takeaways → Body sections with social proof →
 *          Not For You → FAQ with schema → Source Ledger → Related Investigations →
 *          Author bio → Article + FAQPage JSON-LD schemas
 */
function buildArticleHtml(article, persona) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  const faq = Array.isArray(article.faq) ? article.faq : []
  const keyTakeaways = Array.isArray(article.key_takeaways) ? article.key_takeaways : []
  const notForYou = article.not_for_you || ''
  const authorName = article.author_name || persona?.name || 'CryptoKiller Research Team'
  const authorBio = article.author_bio || `${authorName} investigates cryptocurrency fraud at CryptoKiller.`
  const internalLinks = Array.isArray(article.internal_links) ? article.internal_links : []
  // Normalize accessed_date to today — AI models return unreliable/identical dates
  const todayDate = new Date().toISOString().slice(0, 10)
  const sources = (Array.isArray(article.sources) ? article.sources : [])
    .map(s => ({ ...s, accessed_date: todayDate }))
  const socialProof = Array.isArray(article.social_proof) ? article.social_proof : []
  const visualPlaceholders = Array.isArray(article.visual_placeholders) ? article.visual_placeholders : []

  const parts = []

  if (article.summary) {
    parts.push(`<p class="article-summary">${article.summary}</p>`)
  }

  if (keyTakeaways.length > 0) {
    parts.push(`<div class="key-takeaways">\n<h2>Key Takeaways</h2>\n<ul>\n${keyTakeaways.map(t => `<li>${t}</li>`).join('\n')}\n</ul>\n</div>`)
  }

  // Distribute social proof evenly — first quote appears by section 1, max 1 per section, no clustering
  const socialProofMap = {}
  if (socialProof.length > 0 && sections.length > 0) {
    const count = socialProof.length
    const sLen = sections.length
    const startIdx = sLen > 1 ? 1 : 0
    const availableSlots = sLen - startIdx
    const step = count <= 1 ? 1 : Math.max(1, Math.floor(availableSlots / count))
    socialProof.forEach((sp, i) => {
      const targetIdx = Math.min(startIdx + i * step, sLen - 1)
      let finalIdx = targetIdx
      while (socialProofMap[finalIdx] && finalIdx < sLen - 1) finalIdx++
      if (!socialProofMap[finalIdx]) socialProofMap[finalIdx] = []
      socialProofMap[finalIdx].push(sp)
    })
  }

  // Distribute visual placeholders across sections
  const visualMap = {}
  if (visualPlaceholders.length > 0) {
    const interval = Math.max(1, Math.floor(sections.length / visualPlaceholders.length))
    visualPlaceholders.forEach((vp, i) => {
      const targetIdx = Math.min(i * interval, sections.length - 1)
      if (!visualMap[targetIdx]) visualMap[targetIdx] = []
      visualMap[targetIdx].push(vp)
    })
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    let sectionHtml = `<h2>${s.heading || 'Section'}</h2>\n${bodyToHtml(s.body)}`

    if (visualMap[i]) {
      for (const vp of visualMap[i]) {
        const match = String(vp).match(/\[(\w+)(?:\s+NEEDED)?:\s*(.+?)(?:\s*\|\s*Alt:\s*(.+?))?\]/)
        if (match) {
          sectionHtml += `\n<figure class="visual-placeholder" data-type="${match[1].toLowerCase()}">
<div class="placeholder-box" role="img" aria-label="${match[3]?.trim() || match[2].trim()}">[${match[1].toUpperCase()}: ${match[2].trim()}]</div>
<figcaption>${match[3]?.trim() || match[2].trim()}</figcaption>
</figure>`
        }
      }
    }

    if (socialProofMap[i]) {
      for (const sp of socialProofMap[i]) {
        sectionHtml += `\n<blockquote class="social-proof" data-proof-type="${sp.type || 'industry'}">
<p>${sp.content || ''}</p>
<cite>— <strong>${sp.source || 'Source'}</strong>${sp.attribution ? `, ${sp.attribution}` : ''}</cite>
</blockquote>`
      }
    }

    parts.push(sectionHtml)
  }

  if (notForYou) {
    parts.push(`<div class="not-for-you">\n<h2>When This Guide Does NOT Apply</h2>\n${bodyToHtml(notForYou)}\n</div>`)
  }

  if (faq.length > 0) {
    parts.push(`<div class="faq-section">\n<h2>Frequently Asked Questions</h2>\n${faq.map(f => `<details>\n<summary>${f.question}</summary>\n<p>${f.answer || ''}</p>\n</details>`).join('\n')}\n</div>`)
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(f => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer || '' },
      })),
    }
    parts.push(`<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`)
  }

  // Source Ledger
  if (sources.length > 0) {
    parts.push(`<div class="source-ledger">\n<h3>Sources & References</h3>\n<ol>\n${sources.map(s => {
      const typeLabel = s.type ? `[${s.type}]` : ''
      const dateLabel = s.accessed_date ? ` (accessed ${s.accessed_date})` : ''
      return `<li>${typeLabel} <a href="${s.url || '#'}" target="_blank" rel="noopener noreferrer">${s.title || s.url}</a>${dateLabel}</li>`
    }).join('\n')}\n</ol>\n</div>`)
  }

  if (internalLinks.length > 0) {
    parts.push(`<div class="related-reading">\n<h3>Related Investigations</h3>\n<ul>\n${internalLinks.map(l => `<li><a href="${l.target_slug || '#'}">${l.anchor_text}</a> — ${l.context || ''}</li>`).join('\n')}\n</ul>\n</div>`)
  }

  parts.push(`<div class="author-bio">\n<p><strong>${authorName}</strong> — ${authorBio}</p>\n</div>`)

  // Article JSON-LD schema
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.headline || article.title || '',
    description: article.meta_description || article.summary || '',
    author: { '@type': 'Person', name: authorName, description: authorBio },
    publisher: { '@type': 'Organization', name: 'CryptoKiller', url: 'https://cryptokiller.org' },
    datePublished: new Date().toISOString().slice(0, 10),
    dateModified: new Date().toISOString().slice(0, 10),
    mainEntityOfPage: { '@type': 'WebPage' },
    ...(sources.length > 0 ? {
      citation: sources.slice(0, 5).map(s => ({ '@type': 'CreativeWork', name: s.title || '', url: s.url || '' })),
    } : {}),
  }
  parts.push(`<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>`)

  return parts.join('\n\n')
}

/**
 * Fetch aggregate platform intelligence from Supabase for Information Gain.
 */
async function fetchPlatformIntelligence() {
  try {
    const topBrands = await supaFetch('/scam_brands?select=name,slug,scam_score,total_creatives,total_geos,total_celebrities,velocity_trend&order=scam_score.desc&limit=10')
    const allBrands = Array.isArray(topBrands) ? topBrands : []
    const totalCreatives = allBrands.reduce((sum, b) => sum + (b.total_creatives || 0), 0)
    const totalGeos = new Set(allBrands.flatMap(b => b.total_geos || 0)).size || allBrands.length
    const celebrityAbuse = allBrands.filter(b => (b.total_celebrities || 0) > 0).length
    const avgScamScore = allBrands.length > 0 ? Math.round(allBrands.reduce((s, b) => s + (b.scam_score || 0), 0) / allBrands.length) : 0
    const velocities = allBrands.map(b => b.velocity_trend).filter(Boolean)
    const topVelocityTrend = velocities.length > 0 ? velocities.sort((a, b) => velocities.filter(v => v === b).length - velocities.filter(v => v === a).length)[0] : 'stable'
    return {
      totalBrands: allBrands.length,
      totalCreatives, totalGeos, avgScamScore, celebrityAbuse, topVelocityTrend,
      topScamScore: allBrands[0] ? { name: allBrands[0].name, score: allBrands[0].scam_score } : null,
    }
  } catch (err) {
    console.error('[fill/platformIntelligence]', err.message)
    return {}
  }
}

/**
 * Fetch published slugs for real internal linking.
 */
async function fetchPublishedSlugs() {
  try {
    const [reviews, content] = await Promise.all([
      supaFetch('/reviews?status=eq.published&select=slug,brand_id&order=published_at.desc&limit=50'),
      supaFetch('/content?status=eq.published&select=title,slug&order=published_at.desc&limit=30'),
    ])
    const reviewSlugs = []
    if (Array.isArray(reviews)) {
      for (const r of reviews.slice(0, 30)) {
        if (r.slug) {
          let name = r.slug.replace(/-/g, ' ')
          if (r.brand_id) {
            try {
              const brands = await supaFetch(`/scam_brands?id=eq.${r.brand_id}&select=name&limit=1`)
              if (Array.isArray(brands) && brands[0]?.name) name = brands[0].name
            } catch { /* use slug-derived name */ }
          }
          reviewSlugs.push({ slug: r.slug, name })
        }
      }
    }
    return {
      reviews: reviewSlugs,
      content: Array.isArray(content) ? content.filter(c => c.slug) : [],
    }
  } catch (err) {
    console.error('[fill/publishedSlugs]', err.message)
    return { reviews: [], content: [] }
  }
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

          // ── SELECT CONTENT-TYPE-AWARE WRITER PERSONA (after topic is loaded) ──
          const persona = selectPersona({
            contentType: topic.content_type,
            pageRole: topic.page_role,
          })
          const personaMetadata = getPersonaMetadata(persona)
          send({
            step: 'init',
            progress: 10,
            message: `Using writer persona: ${personaMetadata.name} (${personaMetadata.model})`
          })

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

          // ── FETCH PLATFORM INTELLIGENCE + PUBLISHED SLUGS (parallel) ──
          send({ step: 'intel', progress: 15, message: 'Fetching platform intelligence & published content...' })
          const [platformIntelligence, publishedSlugs] = await Promise.all([
            fetchPlatformIntelligence(),
            fetchPublishedSlugs(),
          ])

          const sourceLedger = content.sources || []
          // Build an enhanced topic object that includes the approved outline
          const enhancedTopic = {
            ...topic,
            approved_outline: sections.map((s) => ({
              heading: s.heading,
              description: s.description || '',
              target_word_count: s.target_word_count || 180,
              key_points: s.key_points || [],
            })),
            approved_faq: content.faq || [],
          }

          send({ step: 'writing', progress: 25, message: `Writing article using ${personaMetadata.name}...` })

          // ── GET PERSONA PROMPTS (with platform intelligence + published slugs) ──
          const personaPrompts = getPersonaPrompts(persona, enhancedTopic, parentTopic, sourceLedger, enhancedTopic.approved_outline, enhancedTopic.approved_faq, {
            platformIntelligence,
            publishedSlugs,
          })
          const systemPrompt = personaPrompts.system
          const baseUserPrompt = personaPrompts.user

          // Augment the user prompt with the approved outline and FAQ
          const outlineBlock = sections
            .map((s, i) => {
              const kp = (s.key_points || []).map((p) => `  - ${p}`).join('\n')
              return `${i + 1}. ${s.heading} (~${s.target_word_count || 180} words)\n   ${s.description || ''}\n${kp}`
            })
            .join('\n\n')
          const faqBlock = (content.faq || [])
            .map((f, i) => `${i + 1}. Q: ${f.question}\n   Hint: ${f.answer || f.answer_hint || ''}`)
            .join('\n')

          const augmentedUserPrompt = `${baseUserPrompt}

APPROVED OUTLINE (you MUST follow this structure exactly):
${outlineBlock}

APPROVED FAQ TOPICS (expand each into a full answer):
${faqBlock}

CRITICAL: Follow the outline section order and headings exactly. Expand each section to the target word count. Write full FAQ answers (40-90 words each).`

          let article = null
          let writerModelUsed = 'deterministic-fallback'

          const available = getAvailableModels()
          // Budget: opus 120 + sonnet 80 + gemini 50 = 250s, leaving ~50s for
          // visuals + audit + save + deterministic fallback inside maxDuration=300s.
          // With effort:'low' on Claude 4.6, opus typically returns 6–8k-token
          // articles in well under 90s; 120s is generous headroom.
          const writeAttempts = [
            { model: 'claude-opus', user: augmentedUserPrompt, timeoutMs: 120000, label: 'opus-primary' },
            { model: 'claude-sonnet', user: `${augmentedUserPrompt}\n\nReturn compact JSON only.`, timeoutMs: 80000, label: 'sonnet-compact' },
            ...(available.google
              ? [{ model: 'gemini-pro', user: `${augmentedUserPrompt}\n\nReturn compact JSON only.`, timeoutMs: 50000, jsonMode: true, label: 'gemini-fallback' }]
              : []),
          ]
          for (let i = 0; i < writeAttempts.length; i++) {
            const attempt = writeAttempts[i]
            if (i > 0) {
              send({ step: 'writing', progress: 35 + i * 10, message: `Retrying writer (${attempt.label})...` })
            }
            try {
              const res = await callModel(attempt.model, systemPrompt, attempt.user, {
                maxTokens: 8192,
                timeoutMs: attempt.timeoutMs,
                ...(attempt.jsonMode ? { jsonMode: true } : {}),
              })
              article = extractJSON(res.text)
              writerModelUsed = res.resolvedModel || attempt.model
              break
            } catch (e) {
              console.error(`Writer attempt failed [${attempt.label}]:`, e.message, '| model:', attempt.model, '| timeout:', attempt.timeoutMs)
            }
          }

          if (!article || !article.title) {
            send({ step: 'writing', progress: 60, message: 'AI writer timed out, using deterministic fallback...' })
            article = buildDeterministicArticle(topic, parentTopic, sections, content.faq, sourceLedger)
            writerModelUsed = 'deterministic-fallback'
          }

          // ── Phase 4: Visual Generation ──
          // Parse [CHART NEEDED], [DIAGRAM NEEDED], [IMAGE NEEDED] placeholders
          // and replace with actual rendered visuals
          send({ step: 'visuals', progress: 68, message: 'Generating visual assets...' })

          let visualMeta = []
          try {
            // Process visuals in sections (where placeholders live)
            const sectionResult = await processVisualsSections(
              Array.isArray(article.sections) ? article.sections : sections,
              {
                contentId: contentId,
                contentType: 'content',
                aiHelpers: { callModel, extractJSON },
                onProgress: (step, pct, msg) => send({ step, progress: pct, message: msg }),
              }
            )

            if (sectionResult.stats.total > 0) {
              article.sections = sectionResult.sections
              visualMeta = sectionResult.allVisuals
              send({
                step: 'visuals',
                progress: 82,
                message: `Visual generation complete: ${sectionResult.stats.succeeded}/${sectionResult.stats.total} visuals rendered`,
              })
            } else {
              send({ step: 'visuals', progress: 82, message: 'No visual placeholders found — skipping' })
            }
          } catch (vizErr) {
            console.error('Visual generation phase failed:', vizErr.message)
            send({ step: 'visuals', progress: 82, message: 'Visual generation failed — continuing without visuals' })
          }

          // ── Phase 4b: Hero + Content Images (AI queries → Unsplash → TinyPNG → Supabase) ──
          let heroImageData = null
          let generatedContentImages = []
          try {
            send({ step: 'stock_images', progress: 83, message: 'Generating context-aware stock images...' })
            const imgSet = await generateArticleImages(
              content.slug || `content-${contentId}`,
              { ...article, target_keyword: topic?.target_keyword },
              { contentCount: 2, aiHelpers: { callModel, extractJSON }, maxMjWaitMs: 1, maxMjRetries: 0 }
            )
            // Capture content images regardless of hero success
            generatedContentImages = imgSet.contentImages || []
            if (imgSet.hero) {
              heroImageData = imgSet.hero
              const imgUpdate = {
                hero_image_url: imgSet.hero.url,
                hero_image_alt: imgSet.hero.alt,
                hero_image_credit: imgSet.hero.credit,
              }
              if (imgSet.contentImages.length > 0) {
                imgUpdate.content_images = imgSet.contentImages.map(img => ({
                  url: img.url, alt: img.alt, credit: img.credit,
                  creditUrl: img.creditUrl, placement: img.placement,
                }))
              }
              await supaFetch(`/content?id=eq.${contentId}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(imgUpdate),
              })
              const queryInfo = imgSet.queries?.heroQuery ? ` (hero: "${imgSet.queries.heroQuery}")` : ''
              send({ step: 'stock_images_done', progress: 84, message: `Stock images compressed & uploaded${queryInfo}` })
            }
          } catch (imgErr) {
            console.error('[content/fill] Image pipeline error:', imgErr.message)
            send({ step: 'stock_images_skip', progress: 84, message: `Stock images skipped: ${imgErr.message}` })
          }

          // ── Phase 4c: Inject images into article HTML ──
          let fullArticleHtml = stripVerifyTags(buildArticleHtml(article, persona))

          if (heroImageData?.url || generatedContentImages.length > 0) {
            fullArticleHtml = injectImagesIntoHtml(fullArticleHtml, {
              hero: heroImageData,
              contentImages: generatedContentImages,
            })
            send({ step: 'images_injected', progress: 84, message: 'Images embedded in article body' })
          }

          // Quality audit
          send({ step: 'audit', progress: 84, message: 'Running quality audit...' })

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
            const auditResult = await callModel('gpt-5.4-mini', auditPrompt.system, auditMsg, {
              jsonMode: true,
              timeoutMs: 45000,
            })
            audit = extractJSON(auditResult.text)
          } catch {
            audit = null
          }
          // ── ADD PERSONA METADATA TO AUDIT ──
          if (!audit) audit = {}
          audit.social_proof = article.social_proof || []
          audit.writer_persona = {
            id: personaMetadata.id,
            name: personaMetadata.name,
            title: personaMetadata.title,
            model: personaMetadata.model,
          }

          // Save full article (using pre-built HTML with images already injected)
          send({ step: 'saving', progress: 85, message: 'Saving full article...' })

          const articleSections = Array.isArray(article.sections) ? article.sections : sections
          const articleFaq = Array.isArray(article.faq) ? article.faq : content.faq || []
          const wordCount = fullArticleHtml.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length

          await supaFetch(`/content?id=eq.${contentId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              title: article.title || content.title,
              headline: article.headline || content.headline,
              meta_description: article.meta_description || content.meta_description,
              summary: article.summary || content.summary,
              full_article: fullArticleHtml,
              sections: articleSections,
              faq: articleFaq,              sources: article.sources || sourceLedger,
              internal_links: article.internal_links || content.internal_links || [],
              not_for_you: article.not_for_you || null,
              information_gain_summary: article.information_gain_summary || null,
              verify_tags_count: typeof article.verify_tags_count === 'number' ? article.verify_tags_count : null,
              word_count: wordCount,
              ai_model: writerModelUsed,
              ai_audit: audit,
              visual_meta: visualMeta.length > 0 ? visualMeta : null,
              updated_at: new Date().toISOString(),
            }),
          })

          send({
            step: 'done',
            progress: 100,
            message: `Article generated successfully by ${personaMetadata.name} — review and publish when ready.`,
            result: {
              content_id: contentId,
              word_count: wordCount,
              model: writerModelUsed,
              persona: personaMetadata.name,
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
