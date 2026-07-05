import { revalidatePath } from 'next/cache'
import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON } from '@/lib/ai-models'
import { buildReviewSchema } from '@/lib/review-schema'
import { qualityAuditorPrompt } from '@/lib/review-prompts'
import { dedupeCelebrityList } from '@/lib/threat-score'
import { resolveAdEvidence } from '@/lib/ad-evidence'
import { processVisuals } from '@/lib/visual-generator'
import { generateArticleImages } from '@/lib/images'

// Phase B of the split review-generation pipeline:
//   visuals (Imagen) → audit → hero/content images → revalidate.
// Runs after /generate has persisted the draft. Needs Vercel Pro (300s cap)
// so 3-5 Imagen calls plus the audit model can all complete. Any sub-phase
// that fails is logged and skipped — the whole run still lands at
// generation_status='polished' so the UI unblocks.
export const maxDuration = 300

const PIPELINE_VERSION = 'multi-agent-v1.1-split'

async function patchReview(id, patch) {
  await supabaseRequest(`/reviews?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    headers: { 'Prefer': 'return=minimal' },
  })
}

/**
 * POST /api/admin/reviews/[id]/polish
 * SSE endpoint that finishes a content_generated review.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = params
    if (!id) {
      return Response.json({ error: 'review id required' }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false
        const send = (data) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch {
            // Client disconnected; stop trying to enqueue.
            closed = true
          }
        }

        try {
          send({ step: 'polish_load', progress: 3, message: 'Loading draft…' })

          // Mark in-flight up-front so concurrent requests bail fast.
          await patchReview(id, {
            generation_status: 'polishing',
            polish_error: null,
          })

          const reviewRows = await supabaseRequest(
            `/reviews?id=eq.${id}&select=*`,
          )
          if (!Array.isArray(reviewRows) || reviewRows.length === 0) {
            throw new Error('Review not found')
          }
          const review = reviewRows[0]

          const brandRows = await supabaseRequest(
            `/scam_brands?id=eq.${review.brand_id}&select=*`,
          )
          if (!Array.isArray(brandRows) || brandRows.length === 0) {
            throw new Error('Brand not found for this review')
          }
          const brandData = brandRows[0]

          let fullArticle = review.full_article || ''
          let visualMeta = []
          let auditReport = null
          let auditActualModel = null
          let heroImageResult = null
          let contentImagesResult = []
          const finalStats = { visuals: 0, audit: false, heroImage: false }

          // ─── PHASE B.1: VISUALS ────────────────────────────────────────
          send({ step: 'visuals', progress: 10, message: 'Resolving visual placeholders…' })
          try {
            const vizResult = await processVisuals(fullArticle, {
              contentId: review.brand_id,
              contentType: 'review',
              aiHelpers: { callModel, extractJSON },
              imagenOnly: true, // Gemini/Imagen only — no DALL-E / Unsplash fallbacks.
              onProgress: (step, pct, msg) => {
                // Map visual-generator's 0-100 scale into our 10-45 slice.
                const mapped = 10 + Math.round((pct / 100) * 35)
                send({ step, progress: Math.min(mapped, 45), message: msg })
              },
            })

            if (vizResult.stats.total > 0) {
              fullArticle = vizResult.html
              visualMeta = vizResult.visuals
              finalStats.visuals = vizResult.stats.succeeded
              send({
                step: 'visuals_done',
                progress: 45,
                message: `Visuals: ${vizResult.stats.succeeded}/${vizResult.stats.total} rendered`,
              })
            } else {
              send({ step: 'visuals_skip', progress: 45, message: 'No visual placeholders — skipping' })
            }
          } catch (vizErr) {
            console.error('[polish] Visual generation failed:', vizErr.message)
            send({ step: 'visuals_error', progress: 45, message: `Visuals failed: ${vizErr.message}` })
          }

          // ─── PHASE B.2: AUDIT ──────────────────────────────────────────
          send({ step: 'audit', progress: 50, message: 'Running quality audit…' })
          try {
            // Rebuild enough context to call the auditor.
            const currentDate = review.review_date || new Date().toISOString().split('T')[0]
            const longevityDays = review.trust_indicators?.investigation_period_days ||
              (brandData.last_seen_at && brandData.first_seen_at
                ? Math.max(1, Math.round((new Date(brandData.last_seen_at) - new Date(brandData.first_seen_at)) / 86400000))
                : 0)

            const reviewContent = {
              title: review.title,
              headline: review.headline,
              meta_description: review.meta_description,
              summary: review.summary,
              how_it_works: review.how_it_works,
              red_flags: review.red_flags || [],
              verdict: review.verdict,
              faq: review.faq || [],
              key_takeaways: review.key_takeaways || [],
              not_for_you: review.not_for_you,
              protection_steps: review.protection_steps,
              experience_signals: review.experience_signals || [],
              expertise_depth: review.expertise_depth,
              methodology: review.methodology,
              sources: review.sources || [],
              disclaimer: review.disclaimer,
              // Include the typed entity so the auditor can confirm
              // item_reviewed.type directly (was only visible in the truncated
              // SCHEMA JSON-LD, causing false "not typed" hard fails).
              item_reviewed: review.item_reviewed || null,
            }

            // Real celebrity names (the raw celebrity_list stores comma-joined
            // compound strings, so total_celebrities under-counts — e.g. 2 array
            // elements holding 4 names). Pass the deduped/split names so the
            // auditor cross-checks against the true roster, not a wrong count.
            const auditBrandData = {
              ...brandData,
              celebrity_names: dedupeCelebrityList(brandData.celebrity_list || []),
            }

            const tempSchema = buildReviewSchema({
              reviewContent,
              brandData,
              slug: review.slug,
              currentDate,
              wordCount: review.word_count || 0,
              longevityDays,
            })

            const auditPromptData = qualityAuditorPrompt()
            const auditUserMsg = auditPromptData.userTemplate(
              reviewContent,
              auditBrandData,
              review.sources || [],
              tempSchema,
            )

            // Auditor runs on Claude Sonnet 4.6 (was gpt-5.4-mini primary). The
            // audit now gates publication (validateReviewReadyToPublish), so it
            // runs on a known-good current model, not an unverified provider pin.
            const auditModels = ['claude-sonnet', 'claude-haiku']

            let auditResult = null
            for (const modelKey of auditModels) {
              try {
                auditResult = await callModel(modelKey, auditPromptData.system, auditUserMsg, {
                  jsonMode: true,
                  effort: 'medium',
                })
                break
              } catch (modelErr) {
                console.error(`[polish] Audit model ${modelKey} failed:`, modelErr.message)
                if (modelKey === auditModels[auditModels.length - 1]) throw modelErr
                send({ step: 'audit_retry', progress: 55, message: `${modelKey} unavailable, retrying…` })
              }
            }

            auditReport = extractJSON(auditResult.text)
            auditActualModel = auditResult.usedFallback
              ? `${auditResult.resolvedModel} (fallback from ${auditResult.fallbackFrom})`
              : auditResult.label || auditResult.resolvedModel

            finalStats.audit = true
            const grade = auditReport.grade || '?'
            const score = auditReport.overall_score || 0
            const critCount = (auditReport.critical_fixes || []).length
            send({
              step: 'audit_done',
              progress: 70,
              message: `Audit: ${grade} (${score}/100) — ${critCount} critical fix${critCount !== 1 ? 'es' : ''}`,
            })
          } catch (auditError) {
            console.error('[polish] Quality audit failed:', auditError.message)
            auditActualModel = `failed (${auditError.message.slice(0, 100)})`
            send({ step: 'audit_skip', progress: 70, message: `Audit skipped: ${auditError.message}` })
          }

          // ─── PHASE B.3: HERO + CONTENT IMAGES (Imagen, article-aware) ──
          // Prompts are AI-crafted from the actual article content so the
          // hero and section images are contextually RELATED to this review,
          // not generic crypto stock photography.
          send({ step: 'images', progress: 75, message: 'Generating article-aware images via Imagen…' })
          try {
            // Extract section headings from the rendered HTML so the prompt
            // generator gets real structural context (not the raw JSON fields).
            const sectionHeadings = Array.from(
              fullArticle.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi),
            )
              .map((m) => m[1].replace(/<[^>]*>/g, '').trim())
              .filter(Boolean)
              .slice(0, 5)

            const article = {
              title: review.title || '',
              headline: review.headline || '',
              summary: review.summary || review.meta_description || '',
              target_keyword: brandData.name || '',
              slug: review.slug,
              sections: sectionHeadings.length > 0
                ? sectionHeadings.map((heading) => ({ heading }))
                : (review.key_takeaways || []).slice(0, 4).map((kt) => ({
                    heading: typeof kt === 'string' ? kt : (kt.title || kt.text || ''),
                  })),
            }

            const imgSet = await generateArticleImages(review.slug, article, {
              contentCount: 2,
              aiHelpers: { callModel, extractJSON },
              imagenOnly: true, // Imagen/Gemini only. No Unsplash, no DALL-E, no MJ.
            })

            if (imgSet.hero) {
              heroImageResult = imgSet.hero
              contentImagesResult = imgSet.contentImages || []
              finalStats.heroImage = true
              send({
                step: 'images_done',
                progress: 90,
                message: `Hero + ${contentImagesResult.length} content image(s) generated via Imagen`,
              })
            } else if (imgSet.errors?.length > 0) {
              send({ step: 'images_warn', progress: 90, message: `Image pipeline partial: ${imgSet.errors[0]}` })
            } else {
              send({ step: 'images_skip', progress: 90, message: 'Imagen returned no images' })
            }
          } catch (imgError) {
            console.error('[polish] Image pipeline failed:', imgError.message)
            send({ step: 'images_skip', progress: 90, message: `Images skipped: ${imgError.message}` })
          }

          // ─── PHASE B.3.5: RESOLVE REAL AD-CREATIVE EVIDENCE ────────────
          // Structured evidence (fetched/cached SpyOwl creatives, capped at 5)
          // stored in ad_evidence for the renderer to display as a dedicated
          // section. NOT injected into full_article — that only rendered in SSR,
          // never the React client. Reuses storage-cached creatives; only needs
          // SpyOwl for first-time fetches. Non-fatal.
          let adEvidence = null
          try {
            adEvidence = await resolveAdEvidence({ brand: brandData })
            send({
              step: 'evidence',
              progress: 92,
              message: adEvidence?.images?.length
                ? `Resolved ${adEvidence.images.length} real ad-creative evidence image(s)`
                : 'No ad-creative evidence (no cached creatives / SpyOwl unavailable)',
            })
          } catch (evErr) {
            console.error('[polish] Ad-evidence resolve failed:', evErr.message)
          }

          // ─── PHASE B.4: SAVE EVERYTHING ────────────────────────────────
          send({ step: 'saving', progress: 93, message: 'Saving polished review…' })

          const trustIndicators = {
            ...(review.trust_indicators || {}),
            pipeline_version: PIPELINE_VERSION,
            audit_model: auditActualModel || null,
            audit_score: auditReport?.overall_score || null,
            audit_grade: auditReport?.grade || null,
            audit_critical_fixes: auditReport?.critical_fixes || [],
          }

          // Persist the auditor VETO verdict so the publish gate can block on
          // it (the audit is no longer advisory-only). hard_fail_checks.any_hard_fail
          // → audit_hard_fail; the reason → audit_hard_fail_reason.
          const hardFail = auditReport?.hard_fail_checks?.any_hard_fail === true
          const hardFailReason = hardFail
            ? (auditReport?.hard_fail_checks?.hard_fail_reason || 'Quality auditor flagged a hard fail (see critical_fixes).')
            : null

          const polishPatch = {
            full_article: fullArticle,
            visual_meta: visualMeta.length > 0 ? visualMeta : (review.visual_meta || null),
            trust_indicators: trustIndicators,
            audit_hard_fail: hardFail,
            audit_hard_fail_reason: hardFailReason,
            generation_status: 'polished',
            polish_error: null,
            // Structured scraped ad evidence (renderer displays it as a dedicated
            // section). Only overwrite when freshly resolved, so a transient
            // SpyOwl failure doesn't wipe previously-stored evidence.
            ...(adEvidence ? { ad_evidence: adEvidence } : {}),
          }

          if (heroImageResult) {
            polishPatch.hero_image_url = heroImageResult.url
            polishPatch.hero_image_alt = heroImageResult.alt
            polishPatch.hero_image_credit = heroImageResult.credit
          }
          if (contentImagesResult.length > 0) {
            polishPatch.content_images = contentImagesResult.map((img) => ({
              url: img.url,
              alt: img.alt,
              credit: img.credit,
              creditUrl: img.creditUrl,
              placement: img.placement,
            }))
          }

          await patchReview(id, polishPatch)

          // Flush public caches now that the article is actually presentable.
          try {
            revalidatePath(`/review/${review.slug}`)
            revalidatePath('/')
            revalidatePath('/scams')
          } catch (revalError) {
            console.warn('[polish] Revalidation error (non-fatal):', revalError.message)
          }

          send({
            step: 'done',
            progress: 100,
            message: 'Polish complete!',
            result: {
              review_id: id,
              brand_slug: review.slug,
              generation_status: 'polished',
              visuals_rendered: finalStats.visuals,
              audit_grade: auditReport?.grade || 'skipped',
              audit_score: auditReport?.overall_score || null,
              hero_image: heroImageResult?.url || null,
              pipeline_version: PIPELINE_VERSION,
              models_used: {
                audit: auditActualModel || 'skipped',
              },
            },
          })
        } catch (innerError) {
          console.error('[polish] Fatal error:', innerError.message)
          try {
            await patchReview(id, {
              generation_status: 'polish_failed',
              polish_error: innerError.message.slice(0, 500),
            })
          } catch (patchErr) {
            console.error('[polish] Could not persist failure state:', patchErr.message)
          }
          send({ step: 'error', progress: 0, message: innerError.message, error: true })
        } finally {
          closed = true
          try { controller.close() } catch { /* already closed */ }
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
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
