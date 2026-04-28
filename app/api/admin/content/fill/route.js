import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { qualityAuditorPrompt } from '@/lib/review-prompts'
import { processVisuals, processVisualsSections, stripVerifyTags } from '@/lib/visual-generator'
import { generateArticleImages, injectImagesIntoHtml } from '@/lib/images'
import { selectPersona, getPersonaPrompts, getPersonaMetadata } from '@/lib/writer-personas'
import { runArticlePipeline } from '@/lib/article-pipeline'

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
 *
 * Renders ONLY: Key Takeaways → Body sections (with social proof + visuals) →
 *               Not For You → Related Investigations → Author bio.
 *
 * DOES NOT render: article.summary, FAQ section, Source Ledger, Article
 * JSON-LD, FAQPage JSON-LD. Those are rendered by the Replit SSR layer
 * (artifacts/crypto-review/server/prerender.ts -> renderBlogPost) from the
 * structured `summary`, `faq`, `sources` columns and from the @graph
 * builder. Rendering them inline here too produced visible duplicate
 * intro paragraphs, two FAQ sections, two Source sections, and double
 * structured data per page (the romance-scammer-red-flags incident).
 *
 * This mirrors the matching fix in app/api/admin/content/generate/route.js
 * (commit 4822c58).
 */
function buildArticleHtml(article, persona) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  const keyTakeaways = Array.isArray(article.key_takeaways) ? article.key_takeaways : []
  const notForYou = article.not_for_you || ''
  const authorName = article.author_name || persona?.name || 'CryptoKiller Research Team'

  // Strip leading author name from bio if the model echoed it back. The
  // renderer prepends "{authorName} — " around the bio, so a bio that
  // starts with "P. Nair investigates ..." becomes "P. Nair — P. Nair
  // investigates ...". Defensive strip at write time.
  const rawBio = article.author_bio || `investigates cryptocurrency fraud at CryptoKiller.`
  const escapedAuthor = authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stutterStripRe = new RegExp(`^\\s*${escapedAuthor}\\s*[—\\-:,]?\\s*`, 'i')
  const authorBio = String(rawBio).replace(stutterStripRe, '').trim() || rawBio

  // Filter internal_links to entries with real slugs. The prompt forbids
  // '#' / 'TBD' placeholders, but a defensive filter prevents broken links
  // in the rendered HTML even if the model regresses or legacy drafts
  // slip through. Drops the Related Investigations section entirely if
  // nothing valid survives.
  const internalLinks = (Array.isArray(article.internal_links) ? article.internal_links : [])
    .filter((l) => {
      const t = String(l?.target_slug || '').trim()
      return t && t !== '#' && t !== 'TBD' && t.toLowerCase() !== 'todo' && t.length > 1
    })

  const socialProof = Array.isArray(article.social_proof) ? article.social_proof : []
  const visualPlaceholders = Array.isArray(article.visual_placeholders) ? article.visual_placeholders : []

  const parts = []

  // NOTE: article.summary is NOT rendered here. Replit SSR emits it as a
  // <p class="article-summary"> between byline and body. Rendering it inline
  // would produce the visible duplicate intro paragraph.

  // Key Takeaways (BLUF) — Replit SSR does NOT render this, so we do.
  if (keyTakeaways.length > 0) {
    parts.push(`<div class="key-takeaways">
<h2>Key Takeaways</h2>
<ul>
${keyTakeaways.map((t) => `<li>${t}</li>`).join('\n')}
</ul>
</div>`)
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

  // Defence-in-depth: strip the two patterns the writer prompt now forbids,
  // in case a model regression slips one in. The publish quality gate also
  // catches these but cleaning at render time keeps the rendered HTML safe.
  //   1. "This section [verb]..." opener (description-of-section, not content)
  //   2. "This topic relates to the broader area of '...'" trailer (taxonomy leak)
  // Plus strip a leading echo of article.summary if the model repeats it
  // at the start of the first section body — produces visible duplicate
  // intro paragraphs on the published page.
  const SKELETON_OPENER = /^\s*This\s+section\s+(?:explains|walks\s+through|defines|addresses|provides|details|covers|describes|outlines|introduces|presents|discusses|examines|explores|breaks\s+down)[^.]*\.\s*/i
  const TAXONOMY_TRAILER = /\s*This\s+(?:topic|article|guide|page|section)\s+(?:relates\s+to|is\s+part\s+of|falls\s+under|sits\s+under|belongs\s+to)\s+the\s+broader\s+(?:area|topic|category)\s+of\s+["“'][^"”']+["”']\.?\s*/gi

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    let cleanBody = String(s.body || '')
    cleanBody = cleanBody.replace(SKELETON_OPENER, '')
    cleanBody = cleanBody.replace(TAXONOMY_TRAILER, ' ')
    if (i === 0 && article.summary) {
      const sumWords = String(article.summary).trim().split(/\s+/).slice(0, 12).join(' ')
      if (sumWords.length > 30 && cleanBody.startsWith(sumWords)) {
        cleanBody = cleanBody.slice(sumWords.length).replace(/^[^A-Z0-9]*/, '').trim()
      }
    }
    cleanBody = cleanBody.trim()

    let sectionHtml = `<h2>${s.heading || 'Section'}</h2>\n${bodyToHtml(cleanBody)}`

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

  // FAQ — DO NOT render in fullArticle. Replit SSR (renderBlogPost) emits
  // both the FAQ section and the FAQPage JSON-LD from row.faq. Inline
  // render produced two FAQ sections per page and duplicate structured data.

  // Source Ledger — DO NOT render in fullArticle. Same reason: Replit SSR
  // renders a single Sources section from row.sources. The structured
  // `sources` column is the canonical store.

  if (internalLinks.length > 0) {
    parts.push(`<div class="related-reading">\n<h3>Related Investigations</h3>\n<ul>\n${internalLinks.map((l) => `<li><a href="${l.target_slug}">${l.anchor_text}</a> — ${l.context || ''}</li>`).join('\n')}\n</ul>\n</div>`)
  }

  parts.push(`<div class="author-bio">\n<p><strong>${authorName}</strong> — ${authorBio}</p>\n</div>`)

  // Article JSON-LD — emitted by Replit SSR from the full @graph (with
  // ClaimReview / Article / Speakable / citation[] / about / mentions).
  // Don't emit a second BlogPosting here; duplicate structured-data
  // downgrades the trust signal.

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

          send({ step: 'writing', progress: 22, message: `Writing article via 4-stage pipeline (skeleton -> sections -> faq + aux)...` })

          // ── 4-STAGE ARTICLE PIPELINE ──
          // Replaces the previous monolithic single-call writer. Stages:
          //   A. Skeleton  (Haiku):   title, headline, meta, summary, key_takeaways
          //   B. Sections  (Opus×N parallel, Sonnet retry, deterministic fallback):
          //                full body for each outline section
          //   C. FAQ       (Haiku):   all FAQ answers
          //   D. Aux       (Haiku):   not_for_you, social_proof, visual_placeholders,
          //                internal_links, schema_enrichment, author_bio
          // Per-section retry isolation means one writer failure no longer kills the
          // whole article. Wall clock ~75-90s typical (was 120-200s monolithic).
          // Each stage's attempts are captured in pipelineStages and persisted to
          // ai_audit.pipeline_stages (and also ai_audit.writer_attempts as a legacy
          // alias for any consumer that hasn't migrated).
          const pipelineResult = await runArticlePipeline({
            topic,
            parentTopic,
            sections,
            faq: content.faq || [],
            sourceLedger,
            persona,
            publishedSlugs,
            platformIntelligence,
            onProgress: (event) => send(event),
          })

          const article = pipelineResult.article
          const writerModelUsed = pipelineResult.writerModelUsed
          const pipelineStages = pipelineResult.pipelineStages

          if (pipelineResult.overallDeterministic) {
            // Every stage's AI calls failed — surface clearly, but the article still
            // ships (per-stage deterministic fallbacks produce complete content).
            // The publish quality gate will inspect section bodies separately.
            const firstError = pipelineStages.find((s) => !s.ok)?.error || 'unknown'
            send({
              step: 'pipeline_all_fallback',
              progress: 75,
              message: `All AI stages hit deterministic fallback (first error: ${String(firstError).slice(0, 240)}). Article shippable from outline-derived content; review carefully before publish.`,
              pipeline_stages: pipelineStages,
            })
          } else if (pipelineResult.anyDeterministicFallback) {
            send({
              step: 'pipeline_partial_fallback',
              progress: 75,
              message: `${pipelineResult.sectionDeterministicCount} of ${sections.length} sections used deterministic fallback. Other stages succeeded; review the affected sections before publish.`,
              pipeline_stages: pipelineStages,
            })
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
          // ── ADD PERSONA METADATA + WRITER ATTEMPTS TO AUDIT ──
          if (!audit) audit = {}
          audit.social_proof = article.social_proof || []
          audit.writer_persona = {
            id: personaMetadata.id,
            name: personaMetadata.name,
            title: personaMetadata.title,
            model: personaMetadata.model,
          }
          // Per-stage diagnostic log. Always saved, even when fallback fires —
          // gives a permanent record of what every stage's writer attempt did.
          // Inspect via: SELECT ai_audit->'pipeline_stages' FROM content WHERE slug=...
          // `writer_attempts` is preserved as a legacy alias pointing to the same
          // data so any UI or query that reads the old field keeps working.
          audit.pipeline_stages = pipelineStages
          audit.writer_attempts = pipelineStages

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
              faq: articleFaq,
              sources: article.sources || sourceLedger,
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
