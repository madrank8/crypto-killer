import { readFileSync } from 'fs'
import path from 'path'

import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { callModel, extractJSON, getAvailableModels } from '@/lib/ai-models'
import { topicalArticleWriterPrompt } from '@/lib/content-prompts'
import { qualityAuditorPrompt } from '@/lib/review-prompts'
import { generateImageSet } from '@/lib/images'

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

/**
 * Convert plain-text section body into proper HTML paragraphs.
 * Splits on double newlines → <p> tags. Single newlines → <br/>.
 * Handles {{VERIFY:...}} tags → <span data-verify> for inline rendering.
 */
function bodyToHtml(body) {
  if (!body) return ''
  const text = String(body)

  // Split on double newlines for paragraph breaks
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim())

  return paragraphs.map(p => {
    let html = p.trim()
      .replace(/\n/g, '<br/>')
      // Render {{VERIFY:...}} tags as styled inline markers
      .replace(/\{\{VERIFY:\s*(.+?)\s*\|\s*(.+?)\}\}/g,
        '<span class="verify-tag" data-verify="true" title="$2">[$1]</span>')
      .replace(/\{\{RESEARCH NEEDED:\s*(.+?)\}\}/g,
        '<span class="research-tag" data-verify="research">[$1]</span>')
      .replace(/\{\{SOURCE NEEDED:\s*(.+?)\}\}/g,
        '<span class="source-tag" data-verify="source">[$1]</span>')

    // Don't wrap if already contains block elements
    if (/<(figure|div|img|table|blockquote)\b/i.test(html)) return html
    return `<p>${html}</p>`
  }).join('\n')
}

/**
 * Build full HTML from structured article data.
 * Renders: Summary → Key Takeaways (BLUF) → Body sections with social proof →
 *          Not For You block → FAQ with FAQPage schema → Source Ledger →
 *          Related Investigations → Author bio → Article JSON-LD schema
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

  // Summary / intro
  if (article.summary) {
    parts.push(`<p class="article-summary">${article.summary}</p>`)
  }

  // Key Takeaways (BLUF)
  if (keyTakeaways.length > 0) {
    parts.push(`<div class="key-takeaways">
<h2>Key Takeaways</h2>
<ul>
${keyTakeaways.map(t => `<li>${t}</li>`).join('\n')}
</ul>
</div>`)
  }

  // Distribute social proof across sections (one per ~2 sections)
  const socialProofMap = {}
  if (socialProof.length > 0) {
    const interval = Math.max(1, Math.floor(sections.length / socialProof.length))
    socialProof.forEach((sp, i) => {
      const targetIdx = Math.min(i * interval + interval - 1, sections.length - 1)
      if (!socialProofMap[targetIdx]) socialProofMap[targetIdx] = []
      socialProofMap[targetIdx].push(sp)
    })
  }

  // Distribute visual placeholders across sections (one per ~2 sections)
  const visualMap = {}
  if (visualPlaceholders.length > 0) {
    const interval = Math.max(1, Math.floor(sections.length / visualPlaceholders.length))
    visualPlaceholders.forEach((vp, i) => {
      const targetIdx = Math.min(i * interval, sections.length - 1)
      if (!visualMap[targetIdx]) visualMap[targetIdx] = []
      visualMap[targetIdx].push(vp)
    })
  }

  // Body sections with integrated social proof and visual placeholders
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const bodyHtml = bodyToHtml(s.body)

    let sectionHtml = `<h2>${s.heading || 'Section'}</h2>\n${bodyHtml}`

    // Insert visual placeholder after section body if assigned
    if (visualMap[i]) {
      for (const vp of visualMap[i]) {
        const vpText = String(vp)
        // Parse placeholder: [TYPE NEEDED: description | Alt: alt text]
        const match = vpText.match(/\[(\w+)\s+NEEDED:\s*(.+?)(?:\s*\|\s*Alt:\s*(.+?))?\]/)
        if (match) {
          const type = match[1].toLowerCase()
          const desc = match[2].trim()
          const alt = match[3]?.trim() || desc
          sectionHtml += `\n<figure class="visual-placeholder" data-type="${type}">
<div class="placeholder-box" role="img" aria-label="${alt}">[${type.toUpperCase()}: ${desc}]</div>
<figcaption>${alt}</figcaption>
</figure>`
        }
      }
    }

    // Insert social proof blockquote after section body if assigned
    if (socialProofMap[i]) {
      for (const sp of socialProofMap[i]) {
        const spType = sp.type || 'industry'
        const spSource = sp.source || 'Source'
        const spContent = sp.content || ''
        const spAttr = sp.attribution || ''
        sectionHtml += `\n<blockquote class="social-proof" data-proof-type="${spType}">
<p>${spContent}</p>
<cite>— <strong>${spSource}</strong>${spAttr ? `, ${spAttr}` : ''}</cite>
</blockquote>`
      }
    }

    parts.push(sectionHtml)
  }

  // Not For You block
  if (notForYou) {
    parts.push(`<div class="not-for-you">
<h2>When This Guide Does NOT Apply</h2>
${bodyToHtml(notForYou)}
</div>`)
  }

  // FAQ with FAQPage schema markup
  if (faq.length > 0) {
    parts.push(`<div class="faq-section">
<h2>Frequently Asked Questions</h2>
${faq.map(f => `<details>
<summary>${f.question}</summary>
<p>${f.answer || ''}</p>
</details>`).join('\n')}
</div>`)

    // FAQPage JSON-LD schema
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(f => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.answer || '',
        },
      })),
    }
    parts.push(`<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`)
  }

  // Source Ledger section (rendered with clickable links)
  if (sources.length > 0) {
    parts.push(`<div class="source-ledger">
<h3>Sources & References</h3>
<ol>
${sources.map(s => {
  const typeLabel = s.type ? `[${s.type}]` : ''
  const dateLabel = s.accessed_date ? ` (accessed ${s.accessed_date})` : ''
  return `<li>${typeLabel} <a href="${s.url || '#'}" target="_blank" rel="noopener noreferrer">${s.title || s.url}</a>${dateLabel}</li>`
}).join('\n')}
</ol>
</div>`)
  }

  // Internal links section (rendered as related reading)
  if (internalLinks.length > 0) {
    parts.push(`<div class="related-reading">
<h3>Related Investigations</h3>
<ul>
${internalLinks.map(l => `<li><a href="${l.target_slug || '#'}">${l.anchor_text}</a> — ${l.context || ''}</li>`).join('\n')}
</ul>
</div>`)
  }

  // Author bio
  parts.push(`<div class="author-bio">
<p><strong>${authorName}</strong> — ${authorBio}</p>
</div>`)

  // Article/BlogPosting JSON-LD schema
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.headline || article.title || '',
    description: article.meta_description || article.summary || '',
    author: {
      '@type': 'Person',
      name: authorName,
      description: authorBio,
    },
    publisher: {
      '@type': 'Organization',
      name: 'CryptoKiller',
      url: 'https://cryptokiller.org',
    },
    datePublished: new Date().toISOString().slice(0, 10),
    dateModified: new Date().toISOString().slice(0, 10),
    mainEntityOfPage: {
      '@type': 'WebPage',
    },
    ...(sources.length > 0 ? {
      citation: sources.slice(0, 5).map(s => ({
        '@type': 'CreativeWork',
        name: s.title || '',
        url: s.url || '',
      })),
    } : {}),
  }
  parts.push(`<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>`)

  return parts.join('\n\n')
}

function fallbackSourceLedger(topicKeyword, currentDate) {
  return [
    { title: 'FCA ScamSmart Warning List', url: 'https://www.fca.org.uk/scamsmart/warning-list', type: 'regulatory', accessed_date: currentDate },
    { title: 'FTC Report Fraud', url: 'https://reportfraud.ftc.gov/', type: 'government', accessed_date: currentDate },
    { title: 'FBI IC3', url: 'https://www.ic3.gov/', type: 'government', accessed_date: currentDate },
    { title: `Consumer Protection References for ${topicKeyword}`, url: 'https://www.scamadviser.com/', type: 'consumer_protection', accessed_date: currentDate },
  ]
}

function sourceResearchPrompt(topic, currentDate) {
  const currentYear = new Date().getFullYear()
  return {
    system: `You are a source researcher for topical crypto scam safety content.
Return ONLY valid JSON with this shape:
{
  "sources": [
    { "title": "...", "url": "https://...", "type": "regulatory|government|news|technical|consumer_protection|academic|industry_study", "accessed_date": "YYYY-MM-DD", "publication_year": 2025, "temporal": "ESTABLISHED|RECENT" }
  ]
}
Rules:
- URLs must be real and navigable. Never invent URLs.
- TEMPORAL DIVERSITY: Sources MUST span at least 3 different publication_year values.
  * At least 1 foundational source from 2020-2023 (e.g., FBI IC3 report, academic study, FTC annual data).
  * At least 1 source from ${currentYear - 1} (last year).
  * At least 1 source from ${currentYear} (current year) for semantic freshness.
- MANDATORY: At least 1 source of type "academic" or "industry_study" with named methodology and sample size.
- Prefer regulatory/government sources first (SEC, FTC, FBI IC3, FCA, CFPB).
- accessed_date: set to the source's ACTUAL publication date (YYYY-MM-DD). Each source MUST have a DIFFERENT date.
- publication_year: integer year the source was published. MUST vary across sources.
- For "temporal" field: ESTABLISHED = published > 30 days ago, RECENT = published within last 30 days.
- No markdown fences.`,
    user: `Research credible sources for this topic:
Title: ${topic?.title || 'Crypto scam safety'}
Keyword: ${topic?.target_keyword || topic?.title || ''}
Content Type: ${topic?.content_type || 'educational'}
Description: ${topic?.description || ''}

Return 6-10 sources. Priority order:
1. FBI IC3 Annual Report (most recent year available)
2. FTC consumer protection alerts specific to this scam type
3. SEC investor alerts or enforcement actions
4. CFPB consumer advisories
5. State Attorney General warnings (prefer NY, CA, TX)
6. Academic research or industry study with named methodology + sample size
7. Technical analysis from security firms (Chainalysis, Netcraft, CertiK)
8. At least one current-year (${currentYear}) news article or report for freshness

IMPORTANT: Each source MUST have a unique accessed_date matching its real publication date. NEVER use the same date for all sources. publication_year values MUST include at least 3 different years spanning 2020-${currentYear}.`,
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
    summary: `This guide explains how ${keyword} scams typically operate, how to verify claims before sending money, and what steps to take if you were targeted.`,
    key_takeaways: [
      `${keyword} scams use urgency, social proof, and jargon to pressure fast decisions`,
      'Verify legal entity details, regulator records, and domain history before depositing',
      'Preserve all evidence immediately if you suspect fraud',
      'Avoid anyone asking for upfront recovery fees',
    ],
    sections: [
      { heading: `What ${keyword} usually looks like`, body: `${keyword} scams often combine urgency, social proof, and technical jargon to pressure a fast decision. Common patterns include guaranteed return claims, celebrity or authority impersonation, and direct messages that push users off-platform. ${parentLine}`.trim() },
      { heading: 'Core red flags to check first', body: 'Start with objective checks: registration claims, domain age, support contact quality, and withdrawal terms. If the offer promises fixed returns, requires immediate deposits, or avoids transparent legal/company details, treat it as high risk.' },
      { heading: 'Verification workflow before depositing', body: 'Use a simple sequence: verify legal entity details, confirm regulator records where relevant, inspect domain/WHOIS history, review independent complaint patterns, and test support responses with concrete questions. If multiple checks fail, stop immediately.' },
      { heading: 'What to do if you already sent funds', body: 'Preserve evidence (wallet addresses, transaction IDs, chats, screenshots), notify your payment provider/bank quickly, and report to official channels. Avoid anyone asking for an upfront recovery fee; follow documented reporting paths first.' },
      { heading: 'Prevention habits for future decisions', body: 'Use cooling-off time, independent verification, and strict risk limits. Never rely on social media proof alone. Keep a checklist and require all checks to pass before any transfer. When uncertain, default to not sending funds.' },
    ],
    faq: [
      { question: `Is ${keyword} always a scam?`, answer: 'Not every mention of a keyword is automatically fraudulent, but any offer with pressure tactics, guaranteed returns, or unclear legal identity should be treated as high risk until fully verified.' },
      { question: 'What is the first thing I should verify?', answer: 'Verify legal entity and regulatory claims first, then validate domain history and withdrawal terms. If these are vague, inconsistent, or missing, do not deposit.' },
      { question: 'Can I recover funds after being scammed?', answer: 'Recovery depends on payment method and speed of reporting. Collect evidence immediately, contact your provider, and file official reports. Avoid third parties demanding upfront recovery payments.' },
      { question: 'How should families help a victim?', answer: 'Focus on evidence capture, fast reporting, and emotional support. Avoid blame. Help the victim document timelines and freeze further payments while official complaints are filed.' },
    ],
    sources: sourceLedger || [],
    internal_links: [
      { anchor_text: 'how crypto scam funnels work', target_slug: '/blog/crypto-scam-mechanics', context: 'Explaining persuasion stages and conversion tactics.' },
      { anchor_text: 'crypto scam recovery checklist', target_slug: '/blog/crypto-scam-recovery', context: 'Post-loss action sections.' },
    ],
    not_for_you: `This guide may not apply if you are using a regulated, licensed exchange with verified withdrawal history. It also does not cover disputes with legitimate platforms over fees or service quality — only suspected fraud. If you have already lost funds and need immediate help, skip to our recovery checklist instead.`,
    author_name: 'CryptoKiller Research Team',
    author_bio: 'The CryptoKiller Research Team investigates cryptocurrency fraud using ad intelligence, on-chain analysis, and regulatory data.',
    verify_tags_count: 0,
    reddit_test_passed: false,
    information_gain_summary: 'Deterministic fallback — no unique information gain analysis available.',
  }
}

/**
 * Fetch aggregate platform intelligence from Supabase for Information Gain injection.
 */
async function fetchPlatformIntelligence() {
  try {
    // Total brands
    const brandsCount = await supaFetch('/scam_brands?select=id&limit=1', {
      headers: { Prefer: 'count=exact' },
      rawResponse: true,
    })
    const totalBrands = parseInt(brandsCount?.headers?.get?.('content-range')?.split('/')?.[1] || '0', 10)

    // Aggregate stats via RPC or direct queries
    const topBrands = await supaFetch('/scam_brands?select=name,slug,scam_score,total_creatives,total_geos,total_celebrities,velocity_trend&order=scam_score.desc&limit=10')
    const allBrands = Array.isArray(topBrands) ? topBrands : []

    const totalCreatives = allBrands.reduce((sum, b) => sum + (b.total_creatives || 0), 0)
    const totalGeos = new Set(allBrands.flatMap(b => b.total_geos || 0)).size || allBrands.length
    const celebrityAbuse = allBrands.filter(b => (b.total_celebrities || 0) > 0).length
    const avgScamScore = allBrands.length > 0 ? Math.round(allBrands.reduce((s, b) => s + (b.scam_score || 0), 0) / allBrands.length) : 0
    const velocities = allBrands.map(b => b.velocity_trend).filter(Boolean)
    const topVelocityTrend = velocities.length > 0 ? velocities.sort((a, b) => velocities.filter(v => v === b).length - velocities.filter(v => v === a).length)[0] : 'stable'

    return {
      totalBrands: totalBrands || allBrands.length,
      totalCreatives,
      totalGeos,
      avgScamScore,
      celebrityAbuse,
      topVelocityTrend,
      topScamScore: allBrands[0] ? { name: allBrands[0].name, score: allBrands[0].scam_score } : null,
    }
  } catch (err) {
    console.error('[platformIntelligence] Failed to fetch:', err.message)
    return {}
  }
}

/**
 * Fetch published review and content slugs for real internal linking.
 */
async function fetchPublishedSlugs() {
  try {
    const [reviews, content] = await Promise.all([
      supaFetch('/reviews?status=eq.published&select=slug,brand_id&order=published_at.desc&limit=50'),
      supaFetch('/content?status=eq.published&select=title,slug&order=published_at.desc&limit=30'),
    ])

    // For reviews, fetch brand names
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
    console.error('[publishedSlugs] Failed to fetch:', err.message)
    return { reviews: [], content: [] }
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

          // ── FETCH PLATFORM INTELLIGENCE + PUBLISHED SLUGS (parallel) ──
          send({ step: 'intel', progress: 10, message: 'Fetching platform intelligence & published content...' })
          const [platformIntelligence, publishedSlugs] = await Promise.all([
            fetchPlatformIntelligence(),
            fetchPublishedSlugs(),
          ])

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
            platformIntelligence,
            publishedSlugs,
          })

          let article = null
          let writerModelUsed = 'deterministic-fallback'

          const available = getAvailableModels()
          const writeAttempts = [
            { model: 'claude-opus', user: writerPrompt.user, timeoutMs: 180000, label: 'opus-primary' },
            { model: 'claude-sonnet', user: `${writerPrompt.user}\n\nReturn compact JSON only.`, timeoutMs: 120000, label: 'sonnet-compact' },
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

          // ── HARD FAIL CHECK — remediate missing required fields ──
          const hardFails = []
          if (!article.key_takeaways || !Array.isArray(article.key_takeaways) || article.key_takeaways.length < 4) {
            hardFails.push('key_takeaways missing or < 4 items')
          }
          if (!article.not_for_you || String(article.not_for_you).split(/\s+/).length < 40) {
            hardFails.push('not_for_you missing or < 40 words')
          }
          if (!article.visual_placeholders || !Array.isArray(article.visual_placeholders) || article.visual_placeholders.length < 3) {
            hardFails.push('visual_placeholders < 3')
          }
          if (!article.internal_links || !Array.isArray(article.internal_links) || article.internal_links.length < 2) {
            hardFails.push('internal_links < 2')
          }
          if (!article.social_proof || !Array.isArray(article.social_proof) || article.social_proof.length < 1) {
            hardFails.push('social_proof missing or empty')
          }
          // Check if sections use paragraph breaks (double newlines)
          const flatSections = (article.sections || []).filter(s => s.body && !s.body.includes('\n\n') && s.body.split(/\s+/).length > 80)
          if (flatSections.length > 2) {
            hardFails.push('sections_need_paragraphs — multiple sections over 80 words with no paragraph breaks')
          }
          // Check source freshness — at least one current-year source
          const currentYear = new Date().getFullYear()
          const hasFreshSource = (article.sources || sourceLedger || []).some(s =>
            String(s.accessed_date || s.publication_year || '').includes(String(currentYear))
          )
          if (!hasFreshSource) {
            hardFails.push(`no_fresh_sources — need at least 1 source from ${currentYear}`)
          }

          if (hardFails.length > 0 && writerModelUsed !== 'deterministic-fallback') {
            send({ step: 'remediate', progress: 68, message: `Remediating ${hardFails.length} hard fails: ${hardFails.join(', ')}` })
            try {
              const fixPrompt = `The article JSON is missing required fields. Fix ONLY the missing/insufficient fields and return the complete corrected JSON.

HARD FAILS TO FIX:
${hardFails.map(f => `- ${f}`).join('\n')}

ORIGINAL ARTICLE JSON:
${JSON.stringify(article, null, 2).slice(0, 6000)}

${publishedSlugs?.reviews?.length > 0 ? `AVAILABLE REVIEW SLUGS FOR INTERNAL LINKS:\n${publishedSlugs.reviews.slice(0, 15).map(s => `${s.name} -> /review/${s.slug}`).join(', ')}` : ''}
${publishedSlugs?.content?.length > 0 ? `AVAILABLE BLOG SLUGS:\n${publishedSlugs.content.slice(0, 10).map(s => `${s.title} -> /blog/${s.slug}`).join(', ')}` : ''}

REMEDIATION RULES:
- For social_proof: provide at least 2 items with named sources (real regulatory figures, named studies, or specific Reddit threads with subreddit + upvote count). Never fabricate quotes.
- For internal_links: use REAL slugs from the lists above.
- For sections_need_paragraphs: add double newline (\\n\\n) paragraph breaks in section bodies. Max 3-4 sentences per paragraph.
- For no_fresh_sources: add at least 1 source with accessed_date or publication_year matching ${currentYear}.

Return the COMPLETE corrected JSON object.`
              const fixResult = await callModel('claude-haiku', writerPrompt.system, fixPrompt, {
                maxTokens: 6144,
                timeoutMs: 60000,
              })
              const fixed = extractJSON(fixResult.text)
              if (fixed) {
                // Merge fixes into the original article
                if (fixed.key_takeaways?.length >= 4) article.key_takeaways = fixed.key_takeaways
                if (fixed.not_for_you && String(fixed.not_for_you).split(/\s+/).length >= 40) article.not_for_you = fixed.not_for_you
                if (fixed.visual_placeholders?.length >= 3) article.visual_placeholders = fixed.visual_placeholders
                if (fixed.internal_links?.length >= 2) article.internal_links = fixed.internal_links
                if (fixed.social_proof?.length >= 1) article.social_proof = fixed.social_proof
                if (fixed.author_name) article.author_name = fixed.author_name
                if (fixed.author_bio) article.author_bio = fixed.author_bio
                if (fixed.sources?.length > 0) article.sources = fixed.sources
                // Merge paragraph-broken sections if provided
                if (Array.isArray(fixed.sections) && fixed.sections.length > 0) {
                  for (const fs of fixed.sections) {
                    const match = article.sections.find(s => s.heading === fs.heading)
                    if (match && fs.body?.includes('\n\n')) match.body = fs.body
                  }
                }
              }
            } catch (fixErr) {
              console.error('[remediation] Failed:', fixErr.message)
            }
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
            const auditResult = await callModel('gpt-5.4-mini', auditPrompt.system, auditMsg, {
              jsonMode: true,
              timeoutMs: 45000,
            })
            audit = extractJSON(auditResult.text)
          } catch {
            audit = null
          }

          send({ step: 'saving', progress: 84, message: 'Saving draft content...' })

          const slug = await ensureUniqueContentSlug(article.slug || article.title || topic.title)
          const fullArticle = buildArticleHtml(article)
          const wordCount = fullArticle.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length

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
              sections: Array.isArray(article.sections) ? article.sections : [],
              faq: Array.isArray(article.faq) ? article.faq : [],
              internal_links: article.internal_links || [],
              sources: article.sources || sourceLedger,
              word_count: wordCount,
              status: 'draft',
              ai_model: writerModelUsed,
              ai_audit: {
                ...(audit || {}),
                social_proof: article.social_proof || [],
                writer_persona: { name: article.author_name || 'CryptoKiller Research Team', model: writerModelUsed },
              },
              not_for_you: article.not_for_you || null,
              visual_meta: article.visual_placeholders || [],
              verify_tags_count: article.verify_tags_count || 0,
              reddit_test_passed: article.reddit_test_passed || false,
              information_gain_summary: article.information_gain_summary || null,
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

          // ── GENERATE HERO + CONTENT IMAGES (Unsplash -> TinyPNG -> Supabase) ──
          let heroUrl = null
          try {
            send({ step: 'images', progress: 90, message: 'Generating hero & content images...' })
            const imgSet = await generateImageSet(content.slug, { contentCount: 1 })
            if (imgSet.hero) {
              heroUrl = imgSet.hero.url
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
              await supaFetch(`/content?id=eq.${content.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(imgUpdate),
              })
              send({ step: 'images_done', progress: 96, message: `Images compressed & uploaded` })
            }
          } catch (imgErr) {
            console.error('[content/generate] Image pipeline error:', imgErr.message)
            send({ step: 'images_skip', progress: 96, message: `Images skipped: ${imgErr.message}` })
          }

          send({
            step: 'done',
            progress: 100,
            message: 'Draft article generated successfully.',
            result: {
              content_id: content.id,
              slug: content.slug,
              topic_id: topic.id,
              word_count: wordCount,
              hero_image: heroUrl,
              hard_fails_remediated: hardFails.length > 0 ? hardFails : undefined,
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
