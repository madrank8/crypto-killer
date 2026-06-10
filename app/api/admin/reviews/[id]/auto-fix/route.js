import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { sourceResearcherPrompt } from '@/lib/review-prompts'

const VISUAL_PLACEHOLDER_RE =
  /\[\s*(CHART|DIAGRAM|IMAGE|INFOGRAPHIC|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED[^\]]*\]/gi

function scrubVisualPlaceholders(text) {
  if (typeof text !== 'string') return text
  // NEWLINE-PRESERVING whitespace cleanup. The old `/\s{2,}/g → ' '` collapsed
  // \n\n paragraph breaks, which flattened how_it_works into one paragraph and
  // broke every downstream splitter (funnel cards, parseFunnelStages → Replit
  // funnel_stages). Caught on Crest Fundgrove, 2026-06-10. Collapse runs of
  // spaces/tabs only; normalize blank-line runs to exactly one \n\n.
  return text
    .replace(VISUAL_PLACEHOLDER_RE, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function scrubArrayItems(items, keys) {
  if (!Array.isArray(items)) return items
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item
    const next = { ...item }
    for (const key of keys) {
      if (typeof next[key] === 'string') {
        next[key] = scrubVisualPlaceholders(next[key])
      }
    }
    return next
  })
}

function removeUrls(items, blockedUrls) {
  if (!Array.isArray(items)) return items
  return items.filter((item) => {
    if (!item || typeof item !== 'object') return true
    const url = typeof item.url === 'string' ? item.url : ''
    return !blockedUrls.has(url)
  })
}

function normalizeSourceType(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'regulatory' || t === 'government' || t === 'consumer_protection' || t === 'news' || t === 'technical') {
    return t
  }
  return 'government'
}

function sourceTypeToCitationType(type) {
  const t = normalizeSourceType(type)
  if (t === 'government' || t === 'regulatory') return 'GovernmentService'
  if (t === 'news') return 'NewsArticle'
  if (t === 'technical') return 'Report'
  return 'WebPage'
}

function sourceTypeToPublisher(type) {
  const t = normalizeSourceType(type)
  if (t === 'government') return 'Government'
  if (t === 'regulatory') return 'Regulatory Authority'
  if (t === 'consumer_protection') return 'Consumer Protection'
  if (t === 'news') return 'News'
  return 'Technical Source'
}

async function headCheckUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'missing or non-string URL' }
  }
  try {
    new URL(url)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    })
    if (res.ok) return { ok: true }
    // Many legit domains block bots with 403; allow as soft-pass.
    if (res.status === 403) return { ok: true }
    return { ok: false, reason: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, reason: `network: ${e?.message || 'unknown error'}` }
  }
}

async function researchReplacementSources({ brandName, blockedUrls, existingUrls, limit = 3 }) {
  const today = new Date().toISOString().split('T')[0]
  const availableModels = getAvailableModels()
  const sourceModel = availableModels.google ? 'gemini-flash' : 'claude-haiku'
  const base = sourceResearcherPrompt(brandName, today)

  const user = `${base.user}

AUTO-FIX CONTEXT:
- We are replacing broken citation URLs for this review.
- URLs to avoid (invalid in publish gate):
${Array.from(blockedUrls).map((url) => `  - ${url}`).join('\n')}

- Existing URLs already in this review:
${Array.from(existingUrls).map((url) => `  - ${url}`).join('\n')}

Return ONLY sources that are:
1) Different from all blocked/existing URLs above
2) High-authority and relevant to the same scam/fraud topic
3) Publicly reachable URLs

Need at least ${limit} replacement sources if possible.`

  const srcResult = await callModel(sourceModel, base.system, user, {
    searchGrounding: true,
    jsonMode: sourceModel.startsWith('gemini'),
    timeoutMs: 30000,
  })
  const srcData = extractJSON(srcResult.text)
  const raw = Array.isArray(srcData?.sources) ? srcData.sources : []

  const deduped = []
  const seen = new Set()
  for (const entry of raw) {
    const url = typeof entry?.url === 'string' ? entry.url.trim() : ''
    const title = typeof entry?.title === 'string' ? entry.title.trim() : ''
    if (!url || !title) continue
    if (blockedUrls.has(url) || existingUrls.has(url) || seen.has(url)) continue
    seen.add(url)
    deduped.push({
      title,
      url,
      type: normalizeSourceType(entry?.type),
      publisher: sourceTypeToPublisher(entry?.type),
      datePublished: today,
      accessed_date: today,
    })
    if (deduped.length >= limit * 2) break
  }

  const vetted = []
  for (const candidate of deduped) {
    const check = await headCheckUrl(candidate.url)
    if (check.ok) {
      vetted.push(candidate)
      if (vetted.length >= limit) break
    }
  }
  return vetted
}

export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const issues = Array.isArray(body?.issues) ? body.issues : []
    const citationFixMode = body?.citation_fix_mode === 'replace' ? 'replace' : 'remove'

    const reviewRows = await supabaseRequest(`/reviews?id=eq.${id}&select=*&limit=1`)
    const review = Array.isArray(reviewRows) ? reviewRows[0] : null
    if (!review) {
      return Response.json({ error: 'Review not found' }, { status: 404 })
    }

    const hasPlaceholderIssue = issues.some((issue) => issue?.code === 'UNRESOLVED_VISUAL_PLACEHOLDER')
    const citationIssues = issues.filter((issue) => issue?.code === 'INVALID_CITATION_URL')
    const blockedUrls = new Set(
      citationIssues.map((issue) => issue?.url).filter((url) => typeof url === 'string' && url.length > 0)
    )

    const updates = { updated_at: new Date().toISOString() }
    const applied = []

    if (hasPlaceholderIssue) {
      const scrubFields = [
        'title',
        'headline',
        'meta_description',
        'summary',
        'verdict',
        'how_it_works',
        'not_for_you',
        'protection_steps',
        'methodology',
        'expertise_depth',
        'full_article',
        'disclaimer',
        'information_gain_summary',
      ]
      for (const field of scrubFields) {
        if (typeof review[field] === 'string') {
          updates[field] = scrubVisualPlaceholders(review[field])
        }
      }
      updates.red_flags = scrubArrayItems(review.red_flags, ['flag', 'title', 'detail', 'description'])
      updates.faq = scrubArrayItems(review.faq, ['question', 'answer'])
      updates.funnel_stages = scrubArrayItems(review.funnel_stages, ['title', 'content', 'stat'])
      updates.key_takeaways = Array.isArray(review.key_takeaways)
        ? review.key_takeaways.map((item) =>
            typeof item === 'string' ? scrubVisualPlaceholders(item) : scrubArrayItems([item], ['text'])[0]
          )
        : review.key_takeaways

      if (typeof updates.full_article === 'string') {
        updates.word_count = updates.full_article
          .replace(/<[^>]*>/g, ' ')
          .split(/\s+/)
          .filter(Boolean).length
      }

      applied.push({
        code: 'UNRESOLVED_VISUAL_PLACEHOLDER',
        action: 'remove_placeholder_text',
      })
    }

    if (blockedUrls.size > 0) {
      const nextCitations = removeUrls(review.citations, blockedUrls)
      const nextSources = removeUrls(review.sources, blockedUrls)
      updates.citations = nextCitations
      updates.sources = nextSources

      const removedUrls = Array.from(blockedUrls)
      let replacements = []
      if (citationFixMode === 'replace') {
        let brandName = review?.brand_name || review?.slug || 'crypto scam'
        if (review?.brand_id) {
          try {
            const brandRows = await supabaseRequest(
              `/scam_brands?id=eq.${review.brand_id}&select=name&limit=1`
            )
            if (Array.isArray(brandRows) && brandRows[0]?.name) {
              brandName = brandRows[0].name
            }
          } catch {
            // non-fatal fallback to review/slug value
          }
        }
        const existingUrls = new Set([
          ...((Array.isArray(nextCitations) ? nextCitations : []).map((item) => item?.url).filter(Boolean)),
          ...((Array.isArray(nextSources) ? nextSources : []).map((item) => item?.url).filter(Boolean)),
        ])
        replacements = await researchReplacementSources({
          brandName,
          blockedUrls,
          existingUrls,
          limit: removedUrls.length,
        })

        if (replacements.length > 0) {
          updates.sources = [
            ...(Array.isArray(nextSources) ? nextSources : []),
            ...replacements.map((r) => ({
              title: r.title,
              url: r.url,
              type: r.type,
              accessed_date: r.accessed_date,
            })),
          ]
          updates.citations = [
            ...(Array.isArray(nextCitations) ? nextCitations : []),
            ...replacements.map((r) => ({
              name: r.title,
              url: r.url,
              type: sourceTypeToCitationType(r.type),
              publisher: r.publisher,
              datePublished: r.datePublished,
            })),
          ]
        }
      }

      applied.push({
        code: 'INVALID_CITATION_URL',
        action: citationFixMode === 'replace' ? 'replace_with_vetted_source' : 'remove_citation_url',
        removed_urls: removedUrls,
        replaced_with: replacements.map((r) => r.url),
        unresolved_count: Math.max(0, removedUrls.length - replacements.length),
      })
    }

    if (applied.length === 0) {
      return Response.json({
        success: true,
        message: 'No auto-fixable issues were provided.',
        applied: [],
      })
    }

    await supabaseRequest(`/reviews?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(updates),
    })

    return Response.json({
      success: true,
      review_id: id,
      applied,
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
