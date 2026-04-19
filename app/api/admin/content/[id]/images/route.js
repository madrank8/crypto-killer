import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON } from '@/lib/ai-models'
import { generateArticleImages, injectImagesIntoHtml } from '@/lib/images'
import { processVisuals, stripVerifyTags } from '@/lib/visual-generator'

export const maxDuration = 120

/**
 * POST /api/admin/content/[id]/images
 *
 * Regenerate images for a content article without regenerating the article text.
 * Two image pipelines run in parallel:
 *   1. Unsplash stock images (hero + 2 section images) via AI-generated queries
 *   2. AI-generated visuals (DALL-E, Mermaid, QuickChart) from visual placeholders
 *
 * Body: { mode?: 'all' | 'stock' | 'visuals' }  (default: 'all')
 *   - 'all'     — run both pipelines
 *   - 'stock'   — only Unsplash hero + section images
 *   - 'visuals' — only AI-generated visuals from placeholders
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const mode = body.mode || 'all'

  try {
    // Fetch content + topic
    const rows = await supaFetch(
      `/content?id=eq.${id}&select=id,slug,title,headline,summary,full_article,sections,sources,hero_image_url,content_images,visual_meta&limit=1`
    )
    const content = Array.isArray(rows) ? rows[0] : null
    if (!content) {
      return Response.json({ error: 'Content not found' }, { status: 404 })
    }

    // Get topic for keyword context
    const topicRows = await supaFetch(
      `/topics?content_id=eq.${id}&select=id,title,target_keyword,content_type&limit=1`
    )
    const topic = Array.isArray(topicRows) ? topicRows[0] : null

    const results = {
      stock: null,
      visuals: null,
    }

    // ── Pipeline 1: Unsplash stock images ──
    if (mode === 'all' || mode === 'stock') {
      try {
        const articleContext = {
          title: content.title || content.headline,
          summary: content.summary,
          sections: Array.isArray(content.sections) ? content.sections : [],
          target_keyword: topic?.target_keyword || '',
          slug: content.slug,
        }

        const imgSet = await generateArticleImages(
          content.slug || `content-${id}`,
          articleContext,
          { contentCount: 2, aiHelpers: { callModel, extractJSON } }
        )

        const imgUpdate = {}
        if (imgSet.hero) {
          imgUpdate.hero_image_url = imgSet.hero.url
          imgUpdate.hero_image_alt = imgSet.hero.alt
          imgUpdate.hero_image_credit = imgSet.hero.credit
        }
        if (imgSet.contentImages.length > 0) {
          imgUpdate.content_images = imgSet.contentImages.map(img => ({
            url: img.url,
            alt: img.alt,
            credit: img.credit,
            creditUrl: img.creditUrl,
            placement: img.placement,
          }))
        }

        if (Object.keys(imgUpdate).length > 0) {
          // Also inject images into the article HTML body
          if (content.full_article) {
            const updatedHtml = injectImagesIntoHtml(content.full_article, {
              hero: imgSet.hero,
              contentImages: imgSet.contentImages || [],
            })
            imgUpdate.full_article = updatedHtml
          }

          imgUpdate.updated_at = new Date().toISOString()
          await supaFetch(`/content?id=eq.${id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(imgUpdate),
          })
        }

        results.stock = {
          success: true,
          hero: imgSet.hero ? { url: imgSet.hero.url, alt: imgSet.hero.alt, credit: imgSet.hero.credit } : null,
          contentImages: imgSet.contentImages.length,
          queries: imgSet.queries,
          errors: imgSet.errors,
        }
      } catch (err) {
        results.stock = { success: false, error: err.message }
      }
    }

    // ── Pipeline 2: AI-generated visuals from placeholders ──
    if (mode === 'all' || mode === 'visuals') {
      try {
        const fullArticle = content.full_article || ''

        if (!fullArticle) {
          results.visuals = { success: false, error: 'No full_article to process' }
        } else {
          const vizResult = await processVisuals(fullArticle, {
            contentId: id,
            contentType: 'content',
            aiHelpers: { callModel, extractJSON },
          })

          if (vizResult.stats.total > 0) {
            // Update the full_article with rendered visuals
            const cleanedHtml = stripVerifyTags(vizResult.html)
            await supaFetch(`/content?id=eq.${id}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                full_article: cleanedHtml,
                visual_meta: vizResult.visuals,
                updated_at: new Date().toISOString(),
              }),
            })

            results.visuals = {
              success: true,
              total: vizResult.stats.total,
              succeeded: vizResult.stats.succeeded,
              failed: vizResult.stats.failed,
              visuals: vizResult.visuals.map(v => ({
                type: v.type,
                description: v.description,
                url: v.url,
                succeeded: v.succeeded,
              })),
            }
          } else {
            results.visuals = { success: true, total: 0, message: 'No visual placeholders found' }
          }
        }
      } catch (err) {
        results.visuals = { success: false, error: err.message }
      }
    }

    return Response.json({
      success: true,
      content_id: id,
      mode,
      results,
    })
  } catch (err) {
    console.error('[content/images] Error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
