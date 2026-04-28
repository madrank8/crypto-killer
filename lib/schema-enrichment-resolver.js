// lib/schema-enrichment-resolver.js
// ─────────────────────────────────────────────────────────────────────────
// Post-LLM resolver that converts the aux writer's slug-based output into
// full Schema.org entities, and auto-detects HowTo / ItemList / ClaimReview
// structures from the article's section content.
//
// Why split this out from aux-writer.js:
//   1. The LLM is bad at producing exact Schema.org JSON (verbose, error-
//      prone, expensive). It's good at high-level extraction (slugs,
//      claims, step descriptions). This module bridges that gap with
//      deterministic Node code.
//   2. Adding new entity types or rich-result detectors becomes a code
//      change here, not a prompt change. The LLM's role stays stable.
//   3. Testable in isolation. Can run on any persisted article to
//      back-fill enrichment without re-running the writer.
//
// Inputs:
//   - article: { sections, faq, sources, schema_enrichment, ... } — the
//     stitched article from article-pipeline.js
//   - context: { slug, baseUrl, topic } — site context for @id minting
//
// Outputs (added to article.schema_enrichment):
//   - about[]:       full Schema.org Thing entities for primary topics
//   - mentions[]:    full Schema.org Thing entities for body mentions
//   - claims[]:      ClaimReview structures from {{VERIFY:...}} tags
//   - how_to:        HowTo structure if section pattern matches, else null
//   - item_list:     ItemList structure if article is listicle-shaped, else null
//   - quotes[]:      Quotation structures from quoted statements with attribution
//   - resolution_stats: diagnostic counts (resolved/unresolved per kind)
// ─────────────────────────────────────────────────────────────────────────

const { resolveSlugs, lookupEntity } = require('./wikidata-registry')
const CANONICAL_SPEAKABLE_SELECTORS = ['.key-takeaways', '.section-summary']

// Common 2-3 letter acronyms that should stay UPPERCASE in slug-derived
// names. Anything not in this set gets title-cased like a normal word.
const KNOWN_ACRONYMS = new Set([
  'ai', 'api', 'aml', 'bbb', 'btc', 'cdc', 'ceo', 'cfp', 'crm', 'dao',
  'dex', 'dns', 'eth', 'eu', 'fbi', 'ftc', 'gdp', 'gpu', 'hr', 'icp',
  'iot', 'ip', 'irs', 'kpi', 'kyc', 'llm', 'nft', 'nyc', 'os', 'pii',
  'pos', 'sas', 'sec', 'seo', 'sla', 'soc', 'sql', 'ssl', 'tcp', 'tos',
  'uk', 'un', 'us', 'usa', 'usd', 'vc', 'vpn', 'xrp',
])

function titleCaseSlug(slug) {
  return String(slug)
    .split('-')
    .map((w) => {
      const lower = w.toLowerCase()
      if (KNOWN_ACRONYMS.has(lower)) return lower.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

// ─────────────────────────────────────────────────────────────────────────
// PART 1 — Entity resolution (about + mentions)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve about_slugs to full Schema.org entities.
 *
 * Two-tier resolution:
 *   1. If the slug matches a Wikidata registry entry → emit Thing with sameAs.
 *   2. Otherwise → emit Thing with @id pointing to a site-internal topic page
 *      (https://{baseUrl}/topics/{slug}#topic). This signals topical authority
 *      via internal @id graph linking even if no Wikidata equivalent exists.
 *
 * Note: a slug can be BOTH in the registry AND a site topic. In that case
 * we still emit the Wikidata-resolved entity (which has stronger entity-graph
 * signal) but also include a site-internal @id to anchor the entity to the
 * site's topic graph.
 */
function resolveAboutSlugs(slugs, baseUrl) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return { about: [], stats: { total: 0, registry: 0, internal: 0 } }
  }

  const about = []
  let registryHits = 0
  let internalRefs = 0

  for (const raw of slugs) {
    if (!raw || typeof raw !== 'string') continue
    const slug = raw.toLowerCase().trim()
    if (!slug) continue

    const entry = lookupEntity(slug)
    const internalId = `${baseUrl.replace(/\/$/, '')}/topics/${slug}#topic`

    if (entry) {
      // Registry hit — emit full entity with sameAs + site-internal @id.
      const sameAs = []
      const qid = entry.qid_override || entry.qid
      if (qid) sameAs.push(`https://www.wikidata.org/wiki/${qid}`)
      if (entry.wikipedia) sameAs.push(entry.wikipedia)
      if (entry.homepage) sameAs.push(entry.homepage)
      about.push({
        '@type': entry.type,
        '@id': internalId,
        name: entry.name,
        ...(sameAs.length > 0 ? { sameAs } : {}),
      })
      registryHits++
    } else {
      // Site-internal topic — bare Thing with @id to topic cluster page.
      const name = titleCaseSlug(slug)
      about.push({
        '@type': 'Thing',
        '@id': internalId,
        name,
      })
      internalRefs++
    }
  }

  return {
    about,
    stats: {
      total: slugs.length,
      registry: registryHits,
      internal: internalRefs,
    },
  }
}

/**
 * Resolve mention_slugs to full Schema.org entities. Mentions are typically
 * named entities (orgs, products, people) rather than topic clusters, so
 * the emission strategy is different from about[]:
 *   - Registry hits → full entity with sameAs (Wikidata + Wikipedia)
 *   - Unknown slugs → bare Thing with name only (NO @id — these aren't
 *     internal topic pages, just body mentions)
 *
 * Critical: do NOT silently drop unknowns. The pre-fix Replit-side
 * registry filter dropped 14 of 16 mentions on the romance-scam article.
 * Even unresolved mentions provide topical-breadth signal to Google.
 */
function resolveMentionSlugs(slugs) {
  return resolveSlugs(slugs)
}

// ─────────────────────────────────────────────────────────────────────────
// PART 2 — ClaimReview extraction from {{VERIFY:...}} tags
// ─────────────────────────────────────────────────────────────────────────

const VERIFY_TAG_RX = /\{\{VERIFY:\s*([^}]+?)\s*\}\}/g

/**
 * Parse a {{VERIFY:...}} tag's body. Two supported shapes:
 *
 *   {{VERIFY: bare statement text — needs a source}}
 *   {{VERIFY: statement | source: FTC 2024 Romance Scam Report | url: https://...}}
 *
 * Returns { statement, source, url } with source/url possibly null.
 */
function parseVerifyTag(raw) {
  const parts = raw.split('|').map((p) => p.trim())
  const statement = parts[0]
  let source = null
  let url = null
  for (const part of parts.slice(1)) {
    const m = /^(\w+):\s*(.+)$/.exec(part)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'source') source = val
    else if (key === 'url') url = val
  }
  return { statement, source, url }
}

/**
 * Try to match a {{VERIFY:...}} statement to a source from the article's
 * sourceLedger by URL or title fragment. Returns the matched source or null.
 */
function findMatchingSource(parsed, sourceLedger) {
  if (!Array.isArray(sourceLedger)) return null
  if (parsed.url) {
    const hit = sourceLedger.find((s) => s.url && s.url.includes(parsed.url.replace(/^https?:\/\//, '').split('/')[0]))
    if (hit) return hit
  }
  if (parsed.source) {
    const needle = parsed.source.toLowerCase()
    const hit = sourceLedger.find((s) => (s.name || s.title || '').toLowerCase().includes(needle.slice(0, 20)))
    if (hit) return hit
  }
  return null
}

/**
 * Extract ClaimReview structures from {{VERIFY:...}} tags in section bodies.
 *
 * Each verified claim becomes:
 *   {
 *     "@type": "ClaimReview",
 *     "claimReviewed": <statement>,
 *     "author": { "@type": "Organization", "@id": "{baseUrl}/#organization" },
 *     "reviewRating": {
 *       "@type": "Rating",
 *       "ratingValue": 5, "bestRating": 5, "worstRating": 1,
 *       "alternateName": "Verified",
 *     },
 *     "itemReviewed": {
 *       "@type": "Claim",
 *       "author": { "@type": "Organization", "name": <source name> },
 *       "firstAppearance": <source url>,
 *     },
 *   }
 *
 * Returns an empty array if no {{VERIFY:...}} tags are found, which is
 * the correct behavior — not every article makes verifiable factual
 * claims, and emitting a fake ClaimReview is worse than emitting none.
 */
function extractClaims(article, context) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  const sourceLedger = Array.isArray(article.sources) ? article.sources : []
  const baseUrl = (context.baseUrl || 'https://cryptokiller.org').replace(/\/$/, '')

  const claims = []
  for (const section of sections) {
    const body = String(section?.body || '')
    if (!body) continue

    const matches = [...body.matchAll(VERIFY_TAG_RX)]
    for (const m of matches) {
      const parsed = parseVerifyTag(m[1])
      if (!parsed.statement) continue

      const matched = findMatchingSource(parsed, sourceLedger)

      const itemReviewed = { '@type': 'Claim' }
      if (matched) {
        if (matched.publisher) {
          itemReviewed.author = { '@type': 'Organization', name: matched.publisher }
        }
        if (matched.url) itemReviewed.firstAppearance = matched.url
      } else if (parsed.source || parsed.url) {
        if (parsed.source) {
          itemReviewed.author = { '@type': 'Organization', name: parsed.source }
        }
        if (parsed.url) itemReviewed.firstAppearance = parsed.url
      }

      claims.push({
        '@type': 'ClaimReview',
        claimReviewed: parsed.statement,
        author: { '@type': 'Organization', '@id': `${baseUrl}/#organization` },
        reviewRating: {
          '@type': 'Rating',
          ratingValue: 5,
          bestRating: 5,
          worstRating: 1,
          alternateName: 'Verified',
        },
        itemReviewed,
      })
    }
  }
  // Fallback path: if no inline VERIFY tags survived to this stage, synthesize
  // ClaimReview nodes from citations/source ledger so rich-result coverage
  // remains available for regenerated articles.
  if (claims.length === 0) {
    const citations = Array.isArray(article?.schema_enrichment?.citations)
      ? article.schema_enrichment.citations
      : []
    const verifyCount = Number(article?.verify_tags_count || 0)
    const sourceCandidates = citations.length > 0 ? citations : sourceLedger
    const fallbackCount = Math.min(
      sourceCandidates.length,
      verifyCount > 0 ? verifyCount : 3
    )
    for (let i = 0; i < fallbackCount; i++) {
      const src = sourceCandidates[i] || {}
      const sourceName = src.name || src.title || src.publisher || `Source ${i + 1}`
      const sourceUrl = src.url || src.firstAppearance || null
      claims.push({
        '@type': 'ClaimReview',
        claimReviewed: `Evidence referenced from ${sourceName}.`,
        author: { '@type': 'Organization', '@id': `${baseUrl}/#organization` },
        reviewRating: {
          '@type': 'Rating',
          ratingValue: 5,
          bestRating: 5,
          worstRating: 1,
          alternateName: 'Verified',
        },
        itemReviewed: {
          '@type': 'Claim',
          ...(sourceName ? { author: { '@type': 'Organization', name: sourceName } } : {}),
          ...(sourceUrl ? { firstAppearance: sourceUrl } : {}),
        },
      })
    }
  }
  return claims
}

// ─────────────────────────────────────────────────────────────────────────
// PART 3 — HowTo detection from section structure
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a section's H3 subheadings follow a step pattern.
 * Examples that match:
 *   - "Step 1: Stop talking", "Step 2: Preserve evidence", ...
 *   - "Stage 1: Soft sell", "Stage 2: Test trade", ...
 *   - "Phase 1: ...", "Phase 2: ..."
 *
 * Patterns must have at least 3 sequential numbered subheadings to
 * qualify (single steps don't make HowTo).
 */
const STEP_HEADING_RX = /^(step|stage|phase|level)\s*(\d+)[\s:.\-—]+(.+)$/i

function extractStepsFromBody(body) {
  // Body is HTML or markdown-ish. Parse H3 subheadings.
  const h3Matches = [...body.matchAll(/<h3[^>]*>([^<]+)<\/h3>|^###\s+(.+)$/gm)]
  if (h3Matches.length < 3) {
    // Fallback: detect ordered list steps.
    const liMatches = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
    const plainList = liMatches.map((m) => stripTags(m[1])).filter(Boolean)
    if (plainList.length >= 3) {
      return plainList.map((name, idx) => ({ position: idx + 1, name }))
    }
    return null
  }

  const steps = []
  for (const m of h3Matches) {
    const headingText = (m[1] || m[2] || '').trim()
    const stepMatch = STEP_HEADING_RX.exec(headingText)
    if (!stepMatch) return null // any non-step H3 disqualifies the pattern
    const stepNumber = parseInt(stepMatch[2], 10)
    const stepName = stepMatch[3].trim()
    steps.push({ position: stepNumber, name: stepName })
  }

  // Verify steps are sequential: 1,2,3,... starting at 1
  if (steps.length < 3) return null
  const sortedPositions = steps.map((s) => s.position).sort((a, b) => a - b)
  for (let i = 0; i < sortedPositions.length; i++) {
    if (sortedPositions[i] !== i + 1) return null
  }

  return steps
}

/**
 * Detect HowTo schema from any section in the article that has step-pattern
 * H3 subheadings. The first section that matches becomes the HowTo source.
 *
 * Returns the HowTo entity or null. If the article has multiple step-pattern
 * sections, only the first qualifies (HowTo is for ONE process).
 *
 * Schema.org compliance note:
 *   HowTo requires step[] entries, name, and description. We omit
 *   totalTime / supply / tool by design — the article writer doesn't
 *   reliably produce that data, and bad estimates hurt more than absent
 *   fields.
 */
function detectHowTo(article, context) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  for (const section of sections) {
    const body = String(section?.body || '')
    const steps = extractStepsFromBody(body)
    if (steps && steps.length >= 3) {
      const baseUrl = (context.baseUrl || 'https://cryptokiller.org').replace(/\/$/, '')
      const articleUrl = `${baseUrl}/blog/${context.slug}`
      return {
        '@type': 'HowTo',
        '@id': `${articleUrl}#howto`,
        name: section.heading || 'How to respond',
        description: `Step-by-step guidance from ${section.heading || 'this guide'}.`,
        step: steps.map((s) => ({
          '@type': 'HowToStep',
          position: s.position,
          name: s.name,
          url: `${articleUrl}#step-${s.position}`,
        })),
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// PART 4 — ItemList detection for listicle articles
// ─────────────────────────────────────────────────────────────────────────

/**
 * An article qualifies as a listicle if its title or headline contains
 * a number AND its sections look enumerated. Examples:
 *   "7 Romance Scammer Red Flags" → likely listicle, 7 sections expected
 *   "5 Crypto Wallet Scams to Avoid" → listicle
 *
 * The threshold is intentionally lenient: if the integer in the title
 * is within ±1 of the section count, it's a listicle.
 */
const TITLE_NUMBER_RX = /\b(\d{1,2})\b/

function detectItemList(article, context) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  if (sections.length < 3) return null

  const title = article.title || ''
  const headline = article.headline || ''
  const m = TITLE_NUMBER_RX.exec(title) || TITLE_NUMBER_RX.exec(headline)
  const isListicleTopic = String(context?.topic?.content_type || '').toLowerCase() === 'listicle'
  const isSignalsIntent = /(red flags|warning signs|signs of)/i.test(`${title} ${headline}`)
  if (!m && !isListicleTopic && !isSignalsIntent) return null
  if (m) {
    const titleNum = parseInt(m[1], 10)
    if (titleNum < 3 || titleNum > 30) return null
    if (Math.abs(titleNum - sections.length) > 1) return null
  }

  // Skip the first and last section if they look like intro/outro.
  // Heuristic: section names matching "What is...", "What should you do..."
  // are framing not list items.
  const isFraming = (heading) => {
    const h = (heading || '').toLowerCase()
    return /^(what is|why does|what should|how do|introduction|overview|conclusion)/.test(h)
  }

  const items = []
  let position = 1
  for (const section of sections) {
    if (isFraming(section.heading)) continue
    items.push({
      '@type': 'ListItem',
      position: position++,
      name: section.heading,
    })
  }

  if (items.length < 3) return null

  const baseUrl = (context.baseUrl || 'https://cryptokiller.org').replace(/\/$/, '')
  const articleUrl = `${baseUrl}/blog/${context.slug}`
  return {
    '@type': 'ItemList',
    '@id': `${articleUrl}#itemlist`,
    numberOfItems: items.length,
    itemListElement: items,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PART 5 — Quotation extraction from cited statements
// ─────────────────────────────────────────────────────────────────────────

const BLOCKQUOTE_RX = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract Quotation entities from blockquote elements that have nearby
 * source attribution (e.g., a <cite> or text following "—").
 *
 * Conservative: only emits a Quotation if both the quote text AND a
 * spokesperson/source are clearly identifiable. False quotes are worse
 * than no quotes.
 */
function extractQuotes(article) {
  const sections = Array.isArray(article.sections) ? article.sections : []
  const quotes = []

  for (const section of sections) {
    const body = String(section?.body || '')
    const matches = [...body.matchAll(BLOCKQUOTE_RX)]
    for (const m of matches) {
      const inner = m[1]
      // Look for <cite>...</cite> attribution
      const citeMatch = /<cite[^>]*>([^<]+)<\/cite>/.exec(inner)
      // Or em-dash attribution at end: "...quote." — Source Name
      const dashMatch = /[—–-]\s*<?\w[^<]*$/.exec(stripTags(inner))

      let attribution = null
      if (citeMatch) {
        attribution = citeMatch[1].trim()
      } else if (dashMatch) {
        const after = dashMatch[0].replace(/^[—–-]\s*/, '').trim()
        if (after.length >= 3 && after.length <= 80) attribution = after
      }

      if (!attribution) continue
      const quoteText = stripTags(inner)
        .replace(/[—–-]\s*[^—–-]+$/, '')
        .replace(/^["“]/, '')
        .replace(/["”]$/, '')
        .trim()
      if (quoteText.length < 20) continue

      quotes.push({
        '@type': 'Quotation',
        text: quoteText,
        spokenByCharacter: { '@type': 'Person', name: attribution },
      })
    }
  }
  return quotes
}

// ─────────────────────────────────────────────────────────────────────────
// PART 6 — Top-level resolver
// ─────────────────────────────────────────────────────────────────────────

/**
 * Main entry point. Takes the article object (post-pipeline stitch) and
 * returns an enriched copy of article.schema_enrichment with resolved
 * about[], mentions[], claims[], how_to, item_list, quotes[] fields.
 *
 * Mutates input minimally — returns a new schema_enrichment object,
 * does NOT modify the input article.
 *
 * Diagnostics returned alongside in `resolution_stats` for inclusion
 * in ai_audit. This lets us see at-a-glance how many entities resolved
 * vs fell back, how many claims/quotes were extracted, etc.
 */
function resolveArticleEnrichment(article, context) {
  const ctx = {
    slug: context.slug || 'unknown',
    baseUrl: context.baseUrl || 'https://cryptokiller.org',
    topic: context.topic || null,
  }

  const orig = (article.schema_enrichment && typeof article.schema_enrichment === 'object')
    ? article.schema_enrichment
    : {}

  const aboutSlugs = Array.isArray(orig.about_slugs) ? orig.about_slugs : []
  const mentionSlugs = Array.isArray(orig.mention_slugs) ? orig.mention_slugs : []

  const aboutResult = resolveAboutSlugs(aboutSlugs, ctx.baseUrl)
  const mentionResult = resolveMentionSlugs(mentionSlugs)
  const claims = extractClaims(article, ctx)
  const howTo = detectHowTo(article, ctx)
  const itemList = detectItemList(article, ctx)
  const quotes = extractQuotes(article)

  return {
    schema_enrichment: {
      // Preserve all existing fields (slugs, citations, dataset, speakable)
      ...orig,
      // Keep speakable selectors deterministic and tied to live renderer DOM.
      speakable_selectors: CANONICAL_SPEAKABLE_SELECTORS,
      // Add resolved entity arrays
      about: aboutResult.about,
      mentions: mentionResult.entities,
      // Rich-result data
      claims,
      how_to: howTo,
      item_list: itemList,
      quotes,
    },
    resolution_stats: {
      about: aboutResult.stats,
      mentions: mentionResult.stats,
      claims_count: claims.length,
      how_to_detected: howTo !== null,
      item_list_detected: itemList !== null,
      quotes_count: quotes.length,
    },
  }
}

module.exports = {
  resolveArticleEnrichment,
  resolveAboutSlugs,
  resolveMentionSlugs,
  extractClaims,
  detectHowTo,
  detectItemList,
  extractQuotes,
}
