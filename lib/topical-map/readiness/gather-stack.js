'use strict'

// Stack evidence gatherer (topical-map import robustness design spec section 7
// / task 5). Fills Sullivan `forcing_inputs` ONLY from evidence that already
// exists in our own stack: published reviews/content in Supabase, the live
// cryptokiller.org site, the topic's own map data (internal_links_to, child
// topics), and the curated Wikidata registry checked into this repo. It NEVER
// calls an LLM and NEVER invents a value. A field with no real, cited source
// is left out of `forcing_inputs` and its name is pushed to `missing` instead
// per honesty rule 6 in lib/content-brief/sullivan.js: better blocked than
// invented.
//
// Every filled field carries at least one entry in `sources` documenting
// where the value came from (url + which field it supports + the cited
// quote/value), so a reviewer can verify the claim without re-deriving it.

const { FORCING_INPUT_SPECS } = require('../../content-brief/sullivan')
const { resolveSlug, lookupEntity, buildSchemaEntity } = require('../../wikidata-registry')
const { slugify, tokenize } = require('../text-utils')
const { proposeSullivanType } = require('./propose-sullivan-type')

function fieldNamesFor(contentType) {
  const specs = FORCING_INPUT_SPECS[contentType]
  return Array.isArray(specs) ? specs.map((s) => s.field) : []
}

function cleanStringList(v) {
  if (!Array.isArray(v)) return []
  return v.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}

function slugFromTopic(topic) {
  if (topic.slug && typeof topic.slug === 'string') return topic.slug
  const path = String(topic.url_path || '').trim()
  if (!path) return null
  const parts = path.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

/**
 * Look up a Wikidata Q-ID ONLY in the curated, hand-maintained registry
 * (lib/wikidata-registry.js) - this is already-stored, human-verified data,
 * not a per-topic inference. Mirrors the honesty rule already applied by
 * lib/topical-map/content-brief.js's resolvePrimaryEntity: a registry entry
 * carrying only a Wikidata property id (e.g. bbb's qid: P902) is never
 * surfaced as a verified Q-ID unless a real qid_override entity id exists.
 */
function resolveEntityFromRegistry(topic) {
  const candidates = [topic.target_keyword, topic.title].filter((s) => typeof s === 'string' && s.trim() !== '')
  for (const candidate of candidates) {
    const slug = resolveSlug(slugify(candidate))
    if (!slug) continue
    const entry = lookupEntity(slug)
    const qid = entry?.qid_override || entry?.qid || null
    if (!qid || !/^Q\d+$/.test(qid)) continue // never publish a bare property id (e.g. P902) as verified
    const schema = buildSchemaEntity(slug)
    return {
      name: entry?.name || candidate,
      wikidata_qid: qid,
      same_as: Array.isArray(schema?.sameAs) ? schema.sameAs : [],
    }
  }
  return null
}

/**
 * Distinct quoted sentences from HTML/body text - the only source anecdotes
 * are allowed to come from. Requires min length (drops noise like a bare
 * "OK") and dedupes case-insensitively so a repeated pull-quote does not
 * count twice.
 */
function extractDistinctQuotedSentences(html) {
  if (!html || typeof html !== 'string') return []
  const text = html.replace(/<[^>]+>/g, ' ')
  const pattern = /[“"]([^”"]{20,400}?)[”"]/g
  const seen = new Set()
  const out = []
  let m
  while ((m = pattern.exec(text)) !== null) {
    const quote = m[1].replace(/\s+/g, ' ').trim()
    if (quote.length < 20) continue
    const key = quote.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(quote)
  }
  return out
}

function significantSharedTokens(topic, row) {
  const a = tokenize(`${topic.target_keyword || ''} ${topic.title || ''} ${slugFromTopic(topic) || ''}`)
  const b = tokenize(`${row.slug || ''} ${row.title || ''}`)
  let n = 0
  for (const t of a) {
    if (t.length >= 4 && b.has(t)) n += 1
  }
  return n
}

function overlapsTopic(row, topic) {
  const leaf = slugFromTopic(topic)
  const rowSlug = String(row?.slug || '').trim()
  if (leaf && rowSlug && (rowSlug === leaf || rowSlug.includes(leaf) || leaf.includes(rowSlug))) return true
  return significantSharedTokens(topic, row) >= 2
}

async function safeSelect(supaFetch, path) {
  if (typeof supaFetch !== 'function') return []
  try {
    const rows = await supaFetch(path)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

async function findPublishedReview({ topic, supaFetch, fetchImpl }) {
  const slug = slugFromTopic(topic)
  let review = null

  if (slug) {
    const rows = await safeSelect(
      supaFetch,
      `/reviews?slug=eq.${encodeURIComponent(slug)}&status=eq.published` +
        '&select=id,slug,full_article,author_name,author_credentials&limit=1'
    )
    review = rows[0] || null
  }

  const siteUrl = topic.url_path || (review?.slug ? `/review/${review.slug}/` : null)
  let html = review?.full_article || null

  if (!html && typeof fetchImpl === 'function' && siteUrl) {
    try {
      const res = await fetchImpl(siteUrl)
      if (res && res.ok && typeof res.text === 'function') {
        html = await res.text()
      }
    } catch {
      html = html
    }
  }

  return { review, html, siteUrl }
}

function sanitizeIlike(raw) {
  return String(raw || '')
    .replace(/[%_,()]/g, ' ')
    .replace(/[^a-zA-Z0-9 .-]/g, '')
    .trim()
    .slice(0, 40)
}

async function gatherOverlappingPublished({ topic, supaFetch }) {
  const contentRows = await safeSelect(
    supaFetch,
    '/content?status=eq.published&select=id,slug,title,full_article&limit=100'
  )
  const reviewRows = await safeSelect(
    supaFetch,
    '/reviews?status=eq.published&select=id,slug,title,full_article,author_credentials&limit=100'
  )
  const contentHits = contentRows.filter((r) => overlapsTopic(r, topic)).map((r) => ({ ...r, kind: 'content' }))
  const reviewHits = reviewRows.filter((r) => overlapsTopic(r, topic)).map((r) => ({ ...r, kind: 'review' }))
  return { contentHits, reviewHits }
}

async function gatherSpyOwlObservation({ topic, supaFetch }, result) {
  const kw = sanitizeIlike(topic.target_keyword || topic.title || '')
  if (!kw || kw.length < 3) {
    result.missing.push('field_observation_count')
    return
  }
  const slug = slugify(kw)
  const rows = await safeSelect(
    supaFetch,
    `/scam_brands?or=(normalized_name.eq.${encodeURIComponent(slug)},name.ilike.*${encodeURIComponent(kw)}*)&select=id,geo_list,celebrity_list&limit=500`
  )
  const brands = rows.filter((r) => r && r.id && r.full_article === undefined && r.author_credentials === undefined)
  if (brands.length < 1) {
    result.missing.push('field_observation_count')
    return
  }
  const quote = `${brands.length} SpyOwl brand rows matching query '${kw}' (normalized_name eq ${slug} or name ilike)`
  result.forcing_inputs.field_observation_count = quote
  result.sources.push({
    url: topic.url_path || null,
    field: 'field_observation_count',
    quote,
  })

  const geoCounts = new Map()
  for (const row of brands) {
    const geos = Array.isArray(row.geo_list) ? row.geo_list : []
    for (const g of geos) {
      const key = String(g || '').trim()
      if (!key) continue
      geoCounts.set(key, (geoCounts.get(key) || 0) + 1)
    }
  }
  let topGeo = null
  let topN = 0
  for (const [g, n] of geoCounts) {
    if (n > topN) {
      topGeo = g
      topN = n
    }
  }
  if (topGeo && topN >= 3) {
    const pattern = `${topN} of ${brands.length} matching SpyOwl brands list geo ${topGeo}`
    result.forcing_inputs.recurring_pattern = pattern
    result.sources.push({ url: topic.url_path || null, field: 'recurring_pattern', quote: pattern })
  }
}

async function gatherSiteCredentials({ topic, review, siteUrl, reviewHits, supaFetch }, result) {
  const fromMatch = review?.author_credentials && String(review.author_credentials).trim()
  if (fromMatch) {
    result.forcing_inputs.credentials = fromMatch
    result.sources.push({ url: siteUrl, field: 'credentials', quote: fromMatch })
    return
  }
  const fromOverlap = (reviewHits || []).find((r) => String(r.author_credentials || '').trim())
  if (fromOverlap) {
    const cred = String(fromOverlap.author_credentials).trim()
    result.forcing_inputs.credentials = cred
    result.sources.push({
      url: fromOverlap.slug ? `/review/${fromOverlap.slug}/` : topic.url_path || null,
      field: 'credentials',
      quote: cred,
    })
    return
  }
  const siteRows = await safeSelect(
    supaFetch,
    '/reviews?status=eq.published&author_credentials=not.is.null&select=slug,author_credentials&limit=1'
  )
  const site = siteRows.find((r) => String(r.author_credentials || '').trim())
  if (site) {
    const cred = String(site.author_credentials).trim()
    result.forcing_inputs.credentials = cred
    result.sources.push({
      url: site.slug ? `/review/${site.slug}/` : null,
      field: 'credentials',
      quote: cred,
    })
    return
  }
  result.missing.push('credentials')
}

async function gatherFirsthandReviewEvidence({ topic, supaFetch, fetchImpl }, result) {
  const { review, html, siteUrl } = await findPublishedReview({ topic, supaFetch, fetchImpl })
  const { contentHits, reviewHits } = await gatherOverlappingPublished({ topic, supaFetch })

  const quoteEntries = []
  const seen = new Set()
  const pushQuotes = (text, url) => {
    for (const quote of extractDistinctQuotedSentences(text)) {
      const key = quote.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      quoteEntries.push({ quote, url })
    }
  }
  pushQuotes(html, siteUrl)
  for (const row of [...contentHits, ...reviewHits]) {
    const url = row.kind === 'review' ? `/review/${row.slug}/` : (row.slug ? `/${row.slug}/` : topic.url_path)
    pushQuotes(row.full_article, url)
  }

  if (quoteEntries.length >= 3) {
    result.forcing_inputs.direct_anecdotes = quoteEntries.slice(0, 8).map((e) => e.quote)
    for (const e of quoteEntries.slice(0, 8)) {
      result.sources.push({ url: e.url || null, field: 'direct_anecdotes', quote: e.quote })
    }
  } else {
    result.missing.push('direct_anecdotes')
  }

  await gatherSiteCredentials({ topic, review, siteUrl, reviewHits, supaFetch }, result)
  await gatherSpyOwlObservation({ topic, supaFetch }, result)
  if (!result.forcing_inputs.recurring_pattern) {
    result.missing.push('recurring_pattern')
  }

  return result
}

function semanticRoleFromTopic(topic) {
  const blob = `${topic.title || ''} ${topic.content_format || ''}`
  const path = String(topic.url_path || '')
  if (/\bglossary\b/i.test(blob)) return 'glossary'
  if (/\bfaq\s*hub\b/i.test(blob) || /\bfaq\b/i.test(blob)) return 'faq_hub'
  if (/\bdefinition\b/i.test(blob)) return 'definition'
  if (/\bwiki\b/i.test(blob) || /\/scams\//i.test(path) || /\/check\//i.test(path) || /\/tools\//i.test(path)) {
    return 'entity_page'
  }
  return null
}

async function publishedInternalUrls(supaFetch) {
  const content = await safeSelect(supaFetch, '/content?status=eq.published&select=slug&limit=50')
  const reviews = await safeSelect(supaFetch, '/reviews?status=eq.published&select=slug&limit=50')
  const urls = []
  for (const row of content) {
    if (row?.slug) urls.push(`/${row.slug}/`)
  }
  for (const row of reviews) {
    if (row?.slug) urls.push(`/review/${row.slug}/`)
  }
  return urls
}

async function gatherInfrastructureEvidence({ topic, supaFetch }, result) {
  const entity = resolveEntityFromRegistry(topic)
  if (entity) {
    result.forcing_inputs.entity_id = entity.wikidata_qid
    result.sources.push({
      url: entity.same_as[0] || null,
      field: 'entity_id',
      quote: entity.name,
    })
  } else {
    result.missing.push('entity_id')
  }

  const links = cleanStringList(topic.internal_links_to)
  if (links.length) {
    result.forcing_inputs.internal_link_targets = links
    result.sources.push({ url: topic.url_path || null, field: 'internal_link_targets', quote: links.join(', ') })
  } else {
    const published = await publishedInternalUrls(supaFetch)
    if (published.length >= 3) {
      result.forcing_inputs.internal_link_targets = published.slice(0, 12)
      result.sources.push({
        url: topic.url_path || null,
        field: 'internal_link_targets',
        quote: published.slice(0, 12).join(', '),
      })
    } else {
      result.missing.push('internal_link_targets')
    }
  }

  let childTitles = []
  if (topic.id && typeof supaFetch === 'function') {
    try {
      const rows = await supaFetch(
        `/topics?parent_id=eq.${encodeURIComponent(topic.id)}&select=id,title&order=sort_order.asc`
      )
      childTitles = Array.isArray(rows) ? rows.map((r) => r?.title).filter((t) => typeof t === 'string' && t.trim()) : []
    } catch {
      childTitles = []
    }
  }
  if (childTitles.length >= 3) {
    result.forcing_inputs.sub_entities = childTitles
    result.sources.push({ url: null, field: 'sub_entities', quote: childTitles.join(', ') })
  } else {
    result.missing.push('sub_entities')
  }

  const semanticRole = semanticRoleFromTopic(topic)
  if (semanticRole) {
    result.forcing_inputs.semantic_role = semanticRole
    result.sources.push({ url: topic.url_path || null, field: 'semantic_role', quote: semanticRole })
  } else {
    result.missing.push('semantic_role')
  }

  return result
}

function ymd(value) {
  const s = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

async function gatherOriginalDataStudyEvidence({ topic, supaFetch }, result) {
  if (typeof supaFetch !== 'function') {
    result.missing.push(...fieldNamesFor('original_data_study'))
    return result
  }

  let rows = []
  try {
    rows = await supaFetch(
      '/scam_brands?select=id,last_seen_at,scam_score&order=last_seen_at.desc.nullslast&limit=500'
    )
  } catch {
    rows = []
  }
  const brands = Array.isArray(rows) ? rows : []
  const nSize = brands.length

  if (nSize >= 100) {
    result.forcing_inputs.dataset_source = 'internal_db'
    result.forcing_inputs.n_size = nSize
    result.forcing_inputs.methodology =
      'Crypto Killer SpyOwl scrape stored in scam_brands. n_size is the number of brand rows returned by PostgREST (capped at 500).'
    const collectionDate = ymd(brands[0]?.last_seen_at)
    if (collectionDate) {
      result.forcing_inputs.collection_date = collectionDate
    } else {
      result.missing.push('collection_date')
    }
    const high = brands.filter((b) => Number(b.scam_score) >= 80).length
    result.forcing_inputs.novel_finding =
      `${nSize} tracked brands in the SpyOwl corpus (query cap 500); ${high} currently carry scam_score >= 80.`
    result.sources.push({
      url: topic.url_path || null,
      field: 'n_size',
      quote: String(nSize),
    })
  } else {
    result.missing.push('dataset_source', 'n_size', 'methodology', 'novel_finding', 'collection_date')
  }

  return result
}

/**
 * @param topic { title, url_path?, content_type?, content_format?, notes?,
 *   target_keyword?, internal_links_to?, id? }
 * @param proposeType optional override; when omitted, derived via
 *   proposeSullivanType(topic). Pass explicit null to force "no gather."
 * @param supaFetch optional PostgREST-style fetch (lib/supabase.js shape)
 * @param fetchImpl optional fetch-like function for live-site fallback
 * @returns { content_type, forcing_inputs, sources, missing }
 */
async function gatherStackEvidence({ topic, proposeType, supaFetch, fetchImpl } = {}) {
  const t = topic && typeof topic === 'object' ? topic : {}
  const contentType = proposeType !== undefined ? proposeType : proposeSullivanType(t)

  const result = { content_type: contentType || null, forcing_inputs: {}, sources: [], missing: [] }
  if (!contentType) return result // no proposal -> nothing to gather, nothing to invent

  if (contentType === 'firsthand_review') {
    await gatherFirsthandReviewEvidence({ topic: t, supaFetch, fetchImpl }, result)
  } else if (contentType === 'infrastructure') {
    await gatherInfrastructureEvidence({ topic: t, supaFetch }, result)
  } else if (contentType === 'original_data_study') {
    await gatherOriginalDataStudyEvidence({ topic: t, supaFetch }, result)
  } else {
    // A valid Sullivan type with no stack-gathering path implemented yet
    // (case_study / contrarian_opinion). Report every one of its forcing
    // inputs as missing rather than silently omitting the gate's requirements.
    result.missing.push(...fieldNamesFor(contentType))
  }

  return result
}

module.exports = {
  gatherStackEvidence,
  resolveEntityFromRegistry,
  extractDistinctQuotedSentences,
}
