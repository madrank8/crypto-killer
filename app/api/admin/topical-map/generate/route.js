import { readFileSync } from 'fs'
import path from 'path'

import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import {
  topicalMapKeywordResearchPrompt,
  topicalMapGeneratorPrompt,
  computeTopicPriorityScore,
} from '@/lib/content-prompts'

export const maxDuration = 300

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180) || 'topic'
}

function ensureUniqueSlug(base, usedSlugs) {
  let s = slugify(base) || 'topic'
  if (!usedSlugs.has(s)) {
    usedSlugs.add(s)
    return s
  }
  let i = 2
  while (usedSlugs.has(`${s}-${i}`)) i += 1
  const out = `${s}-${i}`
  usedSlugs.add(out)
  return out
}

function compactPrompt(promptText) {
  return `${promptText}

RELIABILITY OVERRIDE:
- Output must be valid, complete JSON only (no markdown).
- Keep output compact and bounded: exactly 4 pillars, max 4 clusters per pillar, max 4 supporting items per cluster.
- Use short descriptions (1 sentence each).`
}

/**
 * POST /api/admin/topical-map/generate
 * SSE: init → researching → generating → saving → done
 * Body (optional): { name, description, niche }
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const mapName = body.name || `Topical Map ${new Date().toISOString().slice(0, 10)}`
    const mapDescription =
      body.description ||
      'AI-generated topical map for crypto scam education and investigations.'
    const nicheDescription =
      body.niche ||
      'Cryptocurrency investment fraud: pig butchering, fake trading apps, celebrity deepfake ads, recovery, and prevention.'

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          send({ step: 'init', progress: 5, message: 'Loading ICP and catalog data...' })

          const icpPath = path.join(process.cwd(), 'data', 'icp.json')
          const icpRaw = readFileSync(icpPath, 'utf8')
          const icpJson = JSON.parse(icpRaw)

          const icpSummary =
            icpJson?.sections?.audience_description?.summary ||
            'Crypto scam searchers verifying brands before depositing; families helping victims.'

          const publishedReviews = await supaFetch(
            '/reviews?status=eq.published&select=id,slug,brand_id'
          )
          const reviewRows = Array.isArray(publishedReviews) ? publishedReviews : []
          const publishedReviewSlugs = reviewRows.map((r) => r.slug).filter(Boolean)

          const reviewByBrandId = new Map()
          for (const r of reviewRows) {
            if (r.brand_id) reviewByBrandId.set(r.brand_id, r)
          }

          const topBrands = await supaFetch(
            '/scam_brands?select=id,slug,name,scam_score&order=scam_score.desc&limit=100'
          )
          const brandRows = Array.isArray(topBrands) ? topBrands : []
          const brandBySlug = new Map(brandRows.map((b) => [b.slug, b]))

          send({ step: 'researching', progress: 15, message: 'Keyword research (Gemini + search)...' })

          const researchModel = getAvailableModels().google ? 'gemini-pro' : 'claude-haiku'
          const kwPrompt = topicalMapKeywordResearchPrompt({
            nicheDescription,
            icpSummary,
          })

          let keywordResearchJson = {}
          try {
            const kwResult = await callModel(researchModel, kwPrompt.system, kwPrompt.user, {
              searchGrounding: researchModel.startsWith('gemini'),
              maxTokens: 4096,
            })
            keywordResearchJson = extractJSON(kwResult.text)
          } catch (e) {
            console.error('Keyword research failed:', e.message)
            keywordResearchJson = { market_notes: ['Keyword research skipped or failed — generating from ICP + brands only.'] }
            send({
              step: 'researching',
              progress: 18,
              message: `Keyword research fallback: ${e.message.slice(0, 120)}`,
            })
          }

          send({ step: 'generating', progress: 35, message: 'Structuring topical map (Claude Opus)...' })

          const genPrompt = topicalMapGeneratorPrompt({
            nicheDescription,
            icpJson,
            publishedReviewSlugs,
            topScamBrands: brandRows,
            keywordResearchJson,
          })

          const availableModels = getAvailableModels()
          let mapData = null
          let mapResult = null
          let mapModelUsed = 'claude-opus'

          const attempts = [
            { model: 'claude-opus', user: genPrompt.user, jsonMode: false, label: 'opus-primary' },
            { model: 'claude-sonnet', user: compactPrompt(genPrompt.user), jsonMode: false, label: 'sonnet-compact-retry' },
            ...(availableModels.google
              ? [{ model: 'gemini-pro', user: compactPrompt(genPrompt.user), jsonMode: true, label: 'gemini-json-fallback' }]
              : []),
          ]

          let lastParseErr = null
          for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i]
            if (i > 0) {
              send({
                step: 'generating',
                progress: 42 + i * 6,
                message: `Retrying map generation (${attempt.label})...`,
              })
            }

            try {
              const res = await callModel(attempt.model, genPrompt.system, attempt.user, {
                maxTokens: 8192,
                ...(attempt.jsonMode ? { jsonMode: true } : {}),
              })
              const parsed = extractJSON(res.text)
              mapData = parsed
              mapResult = res
              mapModelUsed = res.resolvedModel || attempt.model
              lastParseErr = null
              break
            } catch (e) {
              lastParseErr = e
              console.error(`Topical map parse/generation attempt failed [${attempt.label}]:`, e.message)
            }
          }

          if (!mapData || !mapResult) {
            throw new Error(`Failed to parse topical map JSON: ${lastParseErr?.message || 'unknown parse error'}`)
          }

          const pillars = mapData?.pillars
          if (!Array.isArray(pillars) || pillars.length === 0) {
            throw new Error('AI returned no pillars — try again or shorten inputs.')
          }

          send({ step: 'saving', progress: 70, message: 'Saving map and topics to Supabase...' })

          const mapInsert = await supaFetch('/topical_maps?select=id', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              name: mapName,
              description: mapDescription,
              status: 'active',
              stats: {
                generated_by: 'phase-1-topical-map',
                models: {
                  research: researchModel,
                  structure: mapModelUsed,
                },
              },
            }),
          })
          const mapRow = Array.isArray(mapInsert) ? mapInsert[0] : mapInsert
          const mapId = mapRow?.id
          if (!mapId) throw new Error('Failed to create topical_maps row')

          const usedSlugs = new Set()
          let topicCount = 0

          const nowIso = new Date().toISOString()

          for (let pi = 0; pi < pillars.length; pi++) {
            const pillar = pillars[pi]
            const pBiz = pillar.business_value ?? 50
            const pScore = computeTopicPriorityScore({
              search_volume: pillar.search_volume,
              keyword_difficulty: pillar.keyword_difficulty,
              business_value: pBiz,
            })
            const pSlug = ensureUniqueSlug(pillar.title, usedSlugs)

            const pillarRow = await supaFetch('/topics?select=id', {
              method: 'POST',
              headers: { Prefer: 'return=representation' },
              body: JSON.stringify({
                map_id: mapId,
                parent_id: null,
                topic_type: 'pillar',
                content_type: pillar.content_type || 'pillar_page',
                title: pillar.title,
                slug: pSlug,
                description: pillar.description || null,
                target_keyword: pillar.target_keyword || null,
                secondary_keywords: pillar.secondary_keywords || [],
                search_volume: pillar.search_volume ?? 0,
                keyword_difficulty: pillar.keyword_difficulty ?? 0,
                business_value: pBiz,
                priority_score: pScore,
                content_status: 'planned',
                dependencies: [],
                internal_links_to: [],
                sort_order: pi,
                notes: null,
                updated_at: nowIso,
              }),
            })
            const pillarId = (Array.isArray(pillarRow) ? pillarRow[0] : pillarRow).id
            topicCount += 1

            const clusters = Array.isArray(pillar.clusters) ? pillar.clusters : []
            for (let ci = 0; ci < clusters.length; ci++) {
              const cluster = clusters[ci]
              const cBiz = cluster.business_value ?? 50
              const cScore = computeTopicPriorityScore({
                search_volume: cluster.search_volume,
                keyword_difficulty: cluster.keyword_difficulty,
                business_value: cBiz,
              })
              const cSlug = ensureUniqueSlug(cluster.title, usedSlugs)

              const clusterRow = await supaFetch('/topics?select=id', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                  map_id: mapId,
                  parent_id: pillarId,
                  topic_type: 'cluster',
                  content_type: cluster.content_type || 'educational',
                  title: cluster.title,
                  slug: cSlug,
                  description: cluster.description || null,
                  target_keyword: cluster.target_keyword || null,
                  secondary_keywords: cluster.secondary_keywords || [],
                  search_volume: cluster.search_volume ?? 0,
                  keyword_difficulty: cluster.keyword_difficulty ?? 0,
                  business_value: cBiz,
                  priority_score: cScore,
                  content_status: 'planned',
                  dependencies: [],
                  internal_links_to: [],
                  sort_order: ci,
                  notes: null,
                  updated_at: nowIso,
                }),
              })
              const clusterId = (Array.isArray(clusterRow) ? clusterRow[0] : clusterRow).id
              topicCount += 1

              const supporting = Array.isArray(cluster.supporting) ? cluster.supporting : []
              for (let si = 0; si < supporting.length; si++) {
                const node = supporting[si]
                const nType = node.content_type === 'brand_review' ? 'brand_review' : 'supporting'
                const nBiz = node.business_value ?? 50
                const nScore = computeTopicPriorityScore({
                  search_volume: node.search_volume,
                  keyword_difficulty: node.keyword_difficulty,
                  business_value: nBiz,
                })

                let brandId = null
                let reviewId = null
                let contentStatus = 'planned'
                let slugBase = node.title

                if (node.content_type === 'brand_review' && node.brand_slug) {
                  const b = brandBySlug.get(node.brand_slug)
                  if (b) {
                    brandId = b.id
                    slugBase = b.slug || node.title
                    const rev = reviewByBrandId.get(b.id)
                    if (rev) {
                      reviewId = rev.id
                      contentStatus = 'published'
                    }
                  }
                }

                const sSlug = ensureUniqueSlug(slugBase, usedSlugs)

                await supaFetch('/topics', {
                  method: 'POST',
                  headers: { Prefer: 'return=minimal' },
                  body: JSON.stringify({
                    map_id: mapId,
                    parent_id: clusterId,
                    topic_type: nType,
                    content_type: node.content_type || 'educational',
                    title: node.title,
                    slug: sSlug,
                    description: node.description || null,
                    target_keyword: node.target_keyword || null,
                    secondary_keywords: node.secondary_keywords || [],
                    search_volume: node.search_volume ?? 0,
                    keyword_difficulty: node.keyword_difficulty ?? 0,
                    business_value: nBiz,
                    priority_score: nScore,
                    content_status: contentStatus,
                    brand_id: brandId,
                    review_id: reviewId,
                    dependencies: [],
                    internal_links_to: [],
                    sort_order: si,
                    notes: null,
                    updated_at: nowIso,
                  }),
                })
                topicCount += 1
              }
            }
          }

          await supaFetch(`/topical_maps?id=eq.${mapId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              stats: {
                topic_count: topicCount,
                pillar_count: pillars.length,
                generated_at: nowIso,
              },
              updated_at: nowIso,
            }),
          })

          send({
            step: 'done',
            progress: 100,
            message: `Topical map saved (${topicCount} topics).`,
            result: {
              map_id: mapId,
              map_name: mapName,
              topic_count: topicCount,
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
