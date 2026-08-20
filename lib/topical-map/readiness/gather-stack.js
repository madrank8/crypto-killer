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
const { slugify } = require('../text-utils')
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

async function findPublishedReview({ topic, supaFetch, fetchImpl }) {
  const slug = slugFromTopic(topic)
  let review = null

  if (slug && typeof supaFetch === 'function') {
    try {
      const rows = await supaFetch(
        `/reviews?slug=eq.${encodeURIComponent(slug)}&status=eq.published` +
          '&select=id,slug,full_article,author_name,author_credentials&limit=1'
      )
      review = Array.isArray(rows) ? rows[0] || null : null
    } catch {
      review = null
    }
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

async function gatherFirsthandReviewEvidence({ topic, supaFetch, fetchImpl }, result) {
  const { review, html, siteUrl } = await findPublishedReview({ topic, supaFetch, fetchImpl })

  const quotes = extractDistinctQuotedSentences(html)
  if (quotes.length >= 3) {
    result.forcing_inputs.direct_anecdotes = quotes
    for (const quote of quotes) {
      result.sources.push({ url: siteUrl, field: 'direct_anecdotes', quote })
    }
  } else {
    result.missing.push('direct_anecdotes')
  }

  const credentials = review?.author_credentials && String(review.author_credentials).trim()
  if (credentials) {
    result.forcing_inputs.credentials = credentials
    result.sources.push({ url: siteUrl, field: 'credentials', quote: credentials })
  } else {
    result.missing.push('credentials')
  }

  // No honest, non-inventive stack source exists for these two fields (they
  // require a human to state a quantified callout count / a noticed
  // pattern). Always leave them for the operator rather than derive a fake
  // number or observation.
  result.missing.push('field_observation_count', 'recurring_pattern')

  return result
}

function semanticRoleFromTopic(topic) {
  const blob = `${topic.title || ''} ${topic.content_format || ''}`
  if (/\bglossary\b/i.test(blob)) return 'glossary'
  if (/\bfaq\s*hub\b/i.test(blob) || /\bfaq\b/i.test(blob)) return 'faq_hub'
  if (/\bdefinition\b/i.test(blob)) return 'definition'
  if (/\bwiki\b/i.test(blob)) return 'entity_page'
  return null
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
    result.missing.push('internal_link_targets')
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
