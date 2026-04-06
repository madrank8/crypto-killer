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

async function createTopicWithUniqueSlug({
  row,
  slugBase,
  usedSlugs,
  selectId = false,
}) {
  const base = slugify(slugBase || row.title || 'topic')
  let attempt = 0
  let lastError = null

  while (attempt < 30) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    if (usedSlugs.has(candidate)) {
      attempt += 1
      continue
    }

    try {
      const payload = { ...row, slug: candidate }
      const inserted = await supaFetch(selectId ? '/topics?select=id' : '/topics', {
        method: 'POST',
        headers: { Prefer: selectId ? 'return=representation' : 'return=minimal' },
        body: JSON.stringify(payload),
      })
      usedSlugs.add(candidate)
      if (selectId) {
        const item = Array.isArray(inserted) ? inserted[0] : inserted
        return item?.id || null
      }
      return null
    } catch (e) {
      lastError = e
      const msg = String(e?.message || '')
      if (msg.includes('23505') && msg.includes('topics_slug_key')) {
        attempt += 1
        continue
      }
      throw e
    }
  }

  throw new Error(
    `Unable to allocate unique topic slug for "${row.title || base}": ${lastError?.message || 'unknown error'}`
  )
}

function compactPrompt(promptText) {
  return `${promptText}

RELIABILITY OVERRIDE:
- Output must be valid, complete JSON only (no markdown).
- Keep output compact and bounded: exactly 4 pillars, max 4 clusters per pillar, max 4 supporting items per cluster.
- Use short descriptions (1 sentence each).`
}

function buildFallbackTopicalMap(topicKeyword, topScamBrands = []) {
  const seed = String(topicKeyword || 'crypto scams').trim()
  const brands = (topScamBrands || []).slice(0, 16)

  const brandNodes = brands.map((b) => ({
    title: `${b.name}: Scam Review`,
    target_keyword: `${b.name} scam`,
    search_volume: 800,
    keyword_difficulty: 35,
    business_value: 85,
    content_type: 'brand_review',
    description: `Independent investigation summary for ${b.name}.`,
    secondary_keywords: [`${b.name} review`, `${b.name} legit`],
    brand_slug: b.slug,
  }))

  const takeBrands = (n) => brandNodes.splice(0, n)

  return {
    pillars: [
      {
        title: `${seed}: Complete Guide`,
        target_keyword: seed,
        search_volume: 5000,
        keyword_difficulty: 55,
        business_value: 90,
        content_type: 'pillar_page',
        description: `Comprehensive coverage of ${seed}, warning signs, and response steps.`,
        secondary_keywords: [`${seed} warning signs`, `${seed} examples`],
        clusters: [
          {
            title: `${seed}: How It Works`,
            target_keyword: `${seed} how it works`,
            search_volume: 2500,
            keyword_difficulty: 45,
            business_value: 80,
            content_type: 'educational',
            description: `Break down the mechanics and fraud playbook for ${seed}.`,
            secondary_keywords: ['scam funnel', 'fraud lifecycle'],
            supporting: [
              {
                title: `${seed}: Red Flags Checklist`,
                target_keyword: `${seed} red flags`,
                search_volume: 1800,
                keyword_difficulty: 32,
                business_value: 78,
                content_type: 'guide',
                description: `Quick checklist for early risk detection.`,
                secondary_keywords: ['warning signs', 'scam indicators'],
              },
              ...takeBrands(2),
            ],
          },
          {
            title: `${seed}: Victim Journey`,
            target_keyword: `${seed} victim journey`,
            search_volume: 1100,
            keyword_difficulty: 40,
            business_value: 72,
            content_type: 'educational',
            description: `Explain the timeline from first contact to loss.`,
            secondary_keywords: ['scam psychology', 'manipulation tactics'],
            supporting: [
              {
                title: `Why ${seed} Victims Delay Reporting`,
                target_keyword: `${seed} reporting`,
                search_volume: 600,
                keyword_difficulty: 25,
                business_value: 68,
                content_type: 'educational',
                description: `Common blockers and what to do immediately.`,
                secondary_keywords: ['report scam fast'],
              },
              ...takeBrands(1),
            ],
          },
        ],
      },
      {
        title: `${seed}: Prevention`,
        target_keyword: `${seed} prevention`,
        search_volume: 2200,
        keyword_difficulty: 38,
        business_value: 88,
        content_type: 'pillar_page',
        description: `Prevent losses with practical controls before you deposit.`,
        secondary_keywords: ['avoid scam', 'due diligence'],
        clusters: [
          {
            title: `Due Diligence Before Investing`,
            target_keyword: 'crypto investment due diligence',
            search_volume: 1900,
            keyword_difficulty: 42,
            business_value: 82,
            content_type: 'guide',
            description: `Verification workflow for platforms and offers.`,
            secondary_keywords: ['verify broker', 'license checks'],
            supporting: [
              {
                title: `How to Verify a Crypto Platform`,
                target_keyword: 'verify crypto platform',
                search_volume: 1300,
                keyword_difficulty: 31,
                business_value: 80,
                content_type: 'guide',
                description: `Step-by-step verification across regulators and domains.`,
                secondary_keywords: ['fca check', 'sec check'],
              },
              ...takeBrands(2),
            ],
          },
          {
            title: `Celebrity and Deepfake Scam Defense`,
            target_keyword: 'celebrity crypto scam',
            search_volume: 1400,
            keyword_difficulty: 37,
            business_value: 76,
            content_type: 'prevention',
            description: `Identify fake endorsements and synthetic media lures.`,
            secondary_keywords: ['deepfake ad scam'],
            supporting: [
              {
                title: `How to Spot Deepfake Investment Ads`,
                target_keyword: 'spot deepfake investment ads',
                search_volume: 900,
                keyword_difficulty: 29,
                business_value: 74,
                content_type: 'educational',
                description: `Visual and behavioral tells to verify authenticity.`,
                secondary_keywords: ['fake ad detection'],
              },
              ...takeBrands(1),
            ],
          },
        ],
      },
      {
        title: `${seed}: Recovery`,
        target_keyword: `${seed} recovery`,
        search_volume: 1700,
        keyword_difficulty: 47,
        business_value: 92,
        content_type: 'pillar_page',
        description: `Post-loss action plan and realistic recovery expectations.`,
        secondary_keywords: ['report crypto scam', 'chargeback'],
        clusters: [
          {
            title: `First 24 Hours Recovery Playbook`,
            target_keyword: 'crypto scam first 24 hours',
            search_volume: 1200,
            keyword_difficulty: 33,
            business_value: 90,
            content_type: 'recovery_guide',
            description: `Immediate actions to preserve evidence and reduce further loss.`,
            secondary_keywords: ['freeze accounts', 'file reports'],
            supporting: [
              {
                title: `Evidence Collection Template for Victims`,
                target_keyword: 'crypto scam evidence template',
                search_volume: 500,
                keyword_difficulty: 21,
                business_value: 75,
                content_type: 'guide',
                description: `Checklist for wallets, tx hashes, chats, and domains.`,
                secondary_keywords: ['victim evidence checklist'],
              },
              ...takeBrands(1),
            ],
          },
          {
            title: `Recovery Scam Avoidance`,
            target_keyword: 'crypto recovery scam',
            search_volume: 1500,
            keyword_difficulty: 39,
            business_value: 88,
            content_type: 'prevention',
            description: `Avoid secondary fraud after the initial loss.`,
            secondary_keywords: ['recovery agent scam'],
            supporting: [
              {
                title: `Legitimate vs Fake Recovery Services`,
                target_keyword: 'legit crypto recovery service',
                search_volume: 700,
                keyword_difficulty: 27,
                business_value: 82,
                content_type: 'comparison',
                description: `Decision criteria and disqualifying signals.`,
                secondary_keywords: ['recovery service checklist'],
              },
              ...takeBrands(1),
            ],
          },
        ],
      },
      {
        title: `${seed}: Comparisons and Alternatives`,
        target_keyword: `${seed} alternatives`,
        search_volume: 1100,
        keyword_difficulty: 36,
        business_value: 70,
        content_type: 'pillar_page',
        description: `Compare claims, risks, and safer alternatives.`,
        secondary_keywords: ['is it legit', 'safe alternatives'],
        clusters: [
          {
            title: `Scam Claim vs Reality`,
            target_keyword: 'crypto scam claims vs reality',
            search_volume: 850,
            keyword_difficulty: 30,
            business_value: 65,
            content_type: 'comparison',
            description: `Evaluate common promises against factual constraints.`,
            secondary_keywords: ['guaranteed returns scam'],
            supporting: [
              {
                title: `Guaranteed Return Claims: Reality Check`,
                target_keyword: 'guaranteed crypto returns scam',
                search_volume: 600,
                keyword_difficulty: 26,
                business_value: 62,
                content_type: 'educational',
                description: `Why guaranteed returns signal fraud in this niche.`,
                secondary_keywords: ['too good to be true'],
              },
              ...takeBrands(2),
            ],
          },
          {
            title: `Safe Learning Resources`,
            target_keyword: 'learn crypto scam prevention',
            search_volume: 500,
            keyword_difficulty: 20,
            business_value: 58,
            content_type: 'guide',
            description: `Curated education path for safer decision making.`,
            secondary_keywords: ['crypto safety basics'],
            supporting: [
              {
                title: `Crypto Scam Glossary for Beginners`,
                target_keyword: 'crypto scam glossary',
                search_volume: 400,
                keyword_difficulty: 18,
                business_value: 55,
                content_type: 'glossary',
                description: `Definitions for high-risk scam terminology.`,
                secondary_keywords: ['fraud terms'],
              },
            ],
          },
        ],
      },
    ],
  }
}

/**
 * POST /api/admin/topical-map/generate
 * SSE: init → researching → generating → saving → done
 * Body: { topic_keyword, name?, description?, niche? }
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
    const topicKeyword = String(body.topic_keyword || '').trim()
    if (!topicKeyword) {
      return Response.json({ error: 'topic_keyword is required' }, { status: 400 })
    }

    const mapName =
      body.name ||
      `Topical Map: ${topicKeyword} (${new Date().toISOString().slice(0, 10)})`
    const mapDescription =
      body.description ||
      `AI-generated topical map for "${topicKeyword}" and related crypto scam investigations.`
    const nicheDescription =
      body.niche ||
      `Primary seed topic: ${topicKeyword}. Build a topical authority map around this seed in the crypto scam domain (education, investigation, prevention, recovery, and comparisons).`

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
            send({
              step: 'researching',
              progress: 20,
              message: 'Running keyword research (timeout: 45s)...',
            })
            const kwResult = await callModel(researchModel, kwPrompt.system, kwPrompt.user, {
              searchGrounding: researchModel.startsWith('gemini'),
              maxTokens: 4096,
              timeoutMs: 45000,
            })
            keywordResearchJson = extractJSON(kwResult.text)
            send({
              step: 'researching',
              progress: 28,
              message: 'Keyword research complete.',
            })
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
                timeoutMs: 80000,
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
            send({
              step: 'generating',
              progress: 56,
              message: 'AI JSON parsing failed, using deterministic fallback map...',
            })
            mapData = buildFallbackTopicalMap(topicKeyword, brandRows)
            mapResult = { resolvedModel: 'deterministic-fallback' }
            mapModelUsed = 'deterministic-fallback'
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
            const pillarId = await createTopicWithUniqueSlug({
              slugBase: pillar.title,
              usedSlugs,
              selectId: true,
              row: {
                map_id: mapId,
                parent_id: null,
                topic_type: 'pillar',
                content_type: pillar.content_type || 'pillar_page',
                title: pillar.title,
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
              },
            })
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
              const clusterId = await createTopicWithUniqueSlug({
                slugBase: cluster.title,
                usedSlugs,
                selectId: true,
                row: {
                  map_id: mapId,
                  parent_id: pillarId,
                  topic_type: 'cluster',
                  content_type: cluster.content_type || 'educational',
                  title: cluster.title,
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
                },
              })
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

                await createTopicWithUniqueSlug({
                  slugBase,
                  usedSlugs,
                  selectId: false,
                  row: {
                    map_id: mapId,
                    parent_id: clusterId,
                    topic_type: nType,
                    content_type: node.content_type || 'educational',
                    title: node.title,
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
                  },
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
