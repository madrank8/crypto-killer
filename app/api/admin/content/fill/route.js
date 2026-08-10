import { supaFetch, supabaseCount } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { qualityAuditorPrompt } from '@/lib/review-prompts'
import { processVisuals, processVisualsSections, stripVerifyTags } from '@/lib/visual-generator'
import { generateArticleImages, injectImagesIntoHtml } from '@/lib/images'
import { selectPersona, getPersonaPrompts, getPersonaMetadata } from '@/lib/writer-personas'
import { runArticlePipeline } from '@/lib/article-pipeline'
import { resolveArticleEnrichment } from '@/lib/schema-enrichment-resolver'
import { buildArticleHtml } from '@/lib/article-html'
import { buildAiDisclosure } from '@/lib/ai-disclosure'
import { stampAudit } from '@/lib/audit-freshness'
import { requireSullivanBrief } from '@/lib/content-brief/gate'

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
 * Fetch aggregate platform intelligence from Supabase for Information Gain.
 */
async function fetchPlatformIntelligence() {
  try {
    // Real totals via Prefer: count=exact. The previous version derived
    // totalBrands / totalCreatives / celebrityAbuse from a top-10
    // score-ordered sample, capping every total at 10 — writers were
    // told the platform tracked ~10 brands and a few hundred creatives
    // instead of ~9k brands and ~76k creatives.
    const [totalBrands, totalCreatives, celebrityAbuse] = await Promise.all([
      supabaseCount('/scam_brands?select=id&limit=1'),
      supabaseCount('/creatives?select=id&limit=1'),
      supabaseCount('/scam_brands?select=id&limit=1&total_celebrities=gt.0'),
    ])

    // avgScamScore from a wider, recency-ordered sample so it isn't biased
    // by the top-10 score-ordered slice (which always averages ~95).
    // velocity-trend mode and topScamScore intentionally stay on the
    // score-ordered sample — those are "headline outlier" stats.
    const [recentSample, topBrands] = await Promise.all([
      supaFetch('/scam_brands?select=scam_score&order=updated_at.desc.nullslast&limit=500'),
      supaFetch('/scam_brands?select=name,slug,scam_score,velocity_trend&order=scam_score.desc&limit=10'),
    ])
    const sampleArr = Array.isArray(recentSample) ? recentSample.filter(b => typeof b.scam_score === 'number') : []
    const avgScamScore = sampleArr.length > 0
      ? Math.round(sampleArr.reduce((s, b) => s + b.scam_score, 0) / sampleArr.length)
      : 0
    const allBrands = Array.isArray(topBrands) ? topBrands : []
    const velocities = allBrands.map(b => b.velocity_trend).filter(Boolean)
    const topVelocityTrend = velocities.length > 0
      ? velocities.sort((a, b) => velocities.filter(v => v === b).length - velocities.filter(v => v === a).length)[0]
      : 'stable'

    // totalGeos: previously `new Set(allBrands.flatMap(b => b.total_geos || 0)).size`
    // which flatMaps integers as integers — meaningless. Supabase REST has no
    // COUNT(DISTINCT), so we omit the field rather than mislead the writer.
    // Prompt fallbacks (`pi.totalGeos || 'multiple'`) cover the missing key.
    return {
      totalBrands,
      totalCreatives,
      avgScamScore,
      celebrityAbuse,
      topVelocityTrend,
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

          // Audit 2026-07-05 (A6): prefer the PRESERVED outline. Fill
          // overwrites content.sections with {heading, body} — so a re-run
          // (exactly what the publish gate tells editors to do) used to see
          // headings with no description/key_points/word targets and write a
          // degraded second-generation article. outline_sections is written
          // below on every run and survives fills.
          const sections = (Array.isArray(content.outline_sections) && content.outline_sections.length > 0)
            ? content.outline_sections
            : content.sections
          if (!Array.isArray(sections) || sections.length === 0) {
            throw new Error('No outline found. Generate an outline first.')
          }
          const outlineSections = sections.map((s) => ({
            heading: s.heading,
            description: s.description || '',
            target_word_count: s.target_word_count || 180,
            key_points: s.key_points || [],
          }))
          // Load topic + parent
          let topic = null
          if (content.topic_id) {
            const topicRows = await supaFetch(`/topics?id=eq.${content.topic_id}&select=*&limit=1`)
            topic = Array.isArray(topicRows) ? topicRows[0] : null
          }
          if (!topic) throw new Error('Linked topic not found')

          const gate = await requireSullivanBrief({
            topicId: content.topic_id,
            contentType: topic.content_type,
          })
          if (!gate.ok) {
            send({
              step: 'error',
              status: 'failed',
              error: true,
              code: gate.code,
              message: gate.error,
              topic_id: gate.topic_id,
            })
            controller.close()
            return
          }

          // ── SELECT CONTENT-TYPE-AWARE WRITER PERSONA (after topic is loaded) ──
          const persona = selectPersona({
            contentType: topic.content_type,
            pageRole: topic.page_role,
            // Victim-facing detection (excludes the sardonic Nair voice
            // for recovery/report/lost-money topics — tone-safety rule)
            topicTitle: topic.title,
            targetKeyword: topic.target_keyword,
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

          // ── Phase 4d: Render visual placeholders in the BUILT html ──
          // Audit 2026-07-05 (A1): the aux writer returns placeholders in a
          // separate visual_placeholders array (section bodies are forbidden
          // to contain them), so the Phase-4 section scan above always found
          // zero and literal placeholder boxes shipped to production.
          // buildArticleHtml now injects the raw [TYPE NEEDED: …] markers,
          // and this pass renders them into real charts/diagrams/images.
          try {
            const htmlVisualResult = await processVisuals(fullArticleHtml, {
              contentId,
              contentType: 'content',
              aiHelpers: { callModel, extractJSON },
              onProgress: (step, pct, msg) => send({ step, progress: Math.max(84, pct), message: msg }),
            })
            if (htmlVisualResult.stats.total > 0) {
              fullArticleHtml = htmlVisualResult.html
              visualMeta = [...visualMeta, ...htmlVisualResult.visuals]
              send({
                step: 'visuals_html',
                progress: 84,
                message: `Article visuals rendered: ${htmlVisualResult.stats.succeeded}/${htmlVisualResult.stats.total}`,
              })
            }
          } catch (htmlVizErr) {
            // Non-fatal here — but the publish gate blocks on any surviving
            // [TYPE NEEDED:] marker, so a total failure cannot ship.
            console.error('[content/fill] HTML visual pass failed:', htmlVizErr.message)
            send({ step: 'visuals_html', progress: 84, message: `Visual rendering failed: ${htmlVizErr.message} — publish gate will block until re-run` })
          }

          // Quality audit
          send({ step: 'audit', progress: 84, message: 'Running quality audit...' })

          let audit = null
          let auditModelUsed = null
          try {
            const auditPrompt = qualityAuditorPrompt()
            // W5a reviewer catch (2026-07-05): the auditor's Koray checks
            // 1/2/7 (declaration order, answer-first sections, canonical
            // question in 150 words) systematically fail a well-executed
            // Discover article — the delayed-answer structure is the POINT.
            // Exempt those checks in discover mode; everything else
            // (fabrication, anti-slop, E-E-A-T, sources) stays in force.
            const discoverAuditNote = topic?.content_type === 'discover'
              ? `\n\n═══ DISCOVER MODE EXEMPTION ═══\nThis article is a GOOGLE DISCOVER piece: delayed answer, 2-3 sections, dopamine close — BY DESIGN. Mark koray_audit checks declaration_order, contextual_responsiveness, and question_coverage as "note" (not "fail") when the only issue is the delayed-answer structure. Do NOT deduct koray_relevance/ai_extractability points for structure that discover mode mandates. All other checks apply at full strictness.`
              : ''
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
            ) + discoverAuditNote
            // Auditor: GPT-5.4 Mini at high reasoning effort — a CROSS-VENDOR,
            // fresh-perspective gate over Claude-written prose (same-family
            // self-audit is systematically more lenient; 2026-07-05 W4a). Claude
            // Sonnet (4.6) is the reliability fallback so a single-model failure
            // can't silently wipe the verdict — the old single-model + 60s-cap
            // call produced ZERO verdicts across all 35 content rows.
            // NOTE: these are the model IDs the OpenAI/Anthropic accounts
            // actually have access to. The flagship `gpt-5.4` returns 403
            // (no project access) and `claude-sonnet-4-7` does not exist (404) —
            // both were tried and reverted after breaking the live auditor.
            const auditModels = ['gpt-5.4-mini', 'claude-sonnet']
            let auditResult = null
            for (const modelKey of auditModels) {
              try {
                auditResult = await callModel(modelKey, auditPrompt.system, auditMsg, {
                  jsonMode: true,
                  timeoutMs: 150000,
                  effort: 'high',
                })
                auditModelUsed = auditResult.model || modelKey
                break
              } catch (modelErr) {
                // Loud, not silent: a primary failure means the cross-vendor
                // judge was skipped and a same-family Claude fallback graded.
                console.warn(`[fill] audit model ${modelKey} failed: ${modelErr.message} — falling back`)
                if (modelKey === auditModels[auditModels.length - 1]) throw modelErr
              }
            }
            audit = extractJSON(auditResult.text)
          } catch (auditErr) {
            // Preserve WHY the auditor failed. Critically, do NOT collapse a
            // failed/absent audit into a bare {} — the publish gate would then
            // read that empty object as a passing verdict (undefined
            // any_hard_fail, NaN score) and skip the YMYL floor entirely.
            audit = { audit_status: 'failed', audit_error: String(auditErr?.message || auditErr).slice(0, 200) }
          }
          // ── ADD PERSONA METADATA + WRITER ATTEMPTS TO AUDIT ──
          // Mark provenance so the publish gate can tell "auditor ran and
          // passed" apart from "auditor never produced a verdict".
          if (!audit || typeof audit !== 'object') {
            audit = { audit_status: 'failed', audit_error: 'auditor returned no parseable verdict' }
          }
          if (!audit.audit_status) audit.audit_status = 'ok'
          // Which model actually produced the verdict — makes a silent
          // fallback from the cross-vendor judge to Claude visible on the row.
          audit.audit_model = auditModelUsed
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

          // ── Schema enrichment v2 — resolve slugs to full Schema.org entities ──
          // The aux writer (lib/aux-writer.js) emits high-level slug-based data:
          //   schema_enrichment.about_slugs, .mention_slugs, .citations, .speakable_selectors, .dataset
          // The resolver (lib/schema-enrichment-resolver.js) augments this with:
          //   .about[]      — full Schema.org entities (Wikidata Q-IDs + Wikipedia + site-internal @id)
          //   .mentions[]   — full Schema.org entities for body-mentioned things
          //   .claims[]     — ClaimReview structures from {{VERIFY:...}} tags
          //   .how_to       — HowTo structure if a section has step-pattern H3s
          //   .item_list    — ItemList structure if the article is listicle-shaped
          //   .quotes[]     — Quotation entities from blockquotes with attribution
          // Plus diagnostic stats in resolution_stats (saved to ai_audit).
          //
          // This means the Replit renderer can stop running its own 23-entity
          // registry filter — it just trusts the persisted entity data verbatim.
          // Adding a new entity becomes a one-line change in lib/wikidata-registry.js
          // on this side; no Replit deploy required.
          const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://cryptokiller.org'
          const enrichmentResult = resolveArticleEnrichment(article, {
            slug: content.slug,
            baseUrl,
            topic,
          })
          // Merge the resolved enrichment back into the article object so any
          // downstream rendering (e.g. /review preview, JSON-LD builders) sees
          // the full data without re-running resolution.
          article.schema_enrichment = enrichmentResult.schema_enrichment
          audit.schema_resolution = enrichmentResult.resolution_stats

          const schemaEnrichment = article.schema_enrichment
          const aboutSlugs = Array.isArray(schemaEnrichment.about_slugs) ? schemaEnrichment.about_slugs : []
          const mentionSlugs = Array.isArray(schemaEnrichment.mention_slugs) ? schemaEnrichment.mention_slugs : []
          const speakableSelectors = Array.isArray(schemaEnrichment.speakable_selectors) && schemaEnrichment.speakable_selectors.length > 0
            ? schemaEnrichment.speakable_selectors
            : ['.key-takeaways', '.section-summary']
          const citations = Array.isArray(schemaEnrichment.citations) ? schemaEnrichment.citations : []
          const dataset = (schemaEnrichment.dataset && typeof schemaEnrichment.dataset === 'object') ? schemaEnrichment.dataset : null
          // v2 — full Schema.org entity arrays (NEW columns)
          const about = Array.isArray(schemaEnrichment.about) ? schemaEnrichment.about : []
          const mentions = Array.isArray(schemaEnrichment.mentions) ? schemaEnrichment.mentions : []
          // v2 — rich-result structures (existing columns, were unused before)
          const claims = Array.isArray(schemaEnrichment.claims) ? schemaEnrichment.claims : []
          const howTo = (schemaEnrichment.how_to && typeof schemaEnrichment.how_to === 'object') ? schemaEnrichment.how_to : null
          const itemList = (schemaEnrichment.item_list && typeof schemaEnrichment.item_list === 'object') ? schemaEnrichment.item_list : null
          const quotes = Array.isArray(schemaEnrichment.quotes) ? schemaEnrichment.quotes : []

          const patch = {
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
            // Schema enrichment columns (v1 — slug + simple shapes)
            about_slugs: aboutSlugs,
            mention_slugs: mentionSlugs,
            speakable_selectors: speakableSelectors,
            citations: citations,
            dataset: dataset,
            // Schema enrichment v2 — full Schema.org entities and rich-result structures
            about: about,
            mentions: mentions,
            claims: claims,
            how_to: howTo,
            item_list: itemList,
            quotes: quotes,
            word_count: wordCount,
            ai_model: writerModelUsed,
            // ai_audit is assigned below, after `patch` exists, so the verdict
            // can be stamped with the hash of the row it ships with.
            visual_meta: visualMeta.length > 0 ? visualMeta : null,
            // Audit 2026-07-05 (A3): these four columns were silently
            // dropped by the fill migration — every article shipped with
            // target_keyword/persona/alt-headline null on the live site.
            author_persona_id: personaMetadata.id,
            target_keyword: topic.target_keyword || content.target_keyword || null,
            alternative_headline: article.alternative_headline
              // W5a: discover outlines store the held SEO re-title here —
              // never clobber it with the derived fallback.
              || content.alternative_headline
              || (article.title && article.headline && article.title !== article.headline ? article.title : null),
            reddit_test_passed: article.reddit_test_passed === true,
            // Audit 2026-07-05 (A6): preserve the approved outline so
            // re-running fill regenerates from full context, not bare
            // headings.
            outline_sections: outlineSections,
            // AI disclosure (canon Step 6.8, audit 2026-07-05 W4c)
            ai_disclosure: buildAiDisclosure({
              kind: 'article',
              model: writerModelUsed,
              personaName: personaMetadata.name,
            }),
            updated_at: new Date().toISOString(),
          }

          // Stamp the verdict with the hash of the row it is about to be stored
          // alongside, so a later edit is provably detectable as making this
          // verdict stale (see lib/audit-freshness.js). The hash is taken over
          // the MERGED row — `patch` alone omits columns the auditor reads but
          // fill never writes (item_reviewed, schema_json), and hashing those as
          // null here would mismatch on the next read and report false staleness.
          patch.ai_audit = stampAudit(audit, { ...content, ...patch })

          await supaFetch(`/content?id=eq.${contentId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(patch),
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
