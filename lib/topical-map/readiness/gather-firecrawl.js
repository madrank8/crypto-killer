'use strict'

// Optional Firecrawl scrape gatherer (topical-map import robustness design
// spec section 7 / task 6). This is the second-tier evidence source: it only
// runs when lib/topical-map/readiness/gather-stack.js still has fields
// missing after checking Supabase + the live cryptokiller.org site. It NEVER
// invents anything and NEVER scrapes an arbitrary SERP competitor looking for
// anecdotes - it only fetches URLs we already know about (our own domain, or
// an outbound URL already linked from one of our own pages). A missing
// FIRECRAWL_API_KEY is a normal, silent skip, never a thrown error.
//
// Endpoint verified against the current Firecrawl docs at implement time
// (2026-07-29): scrape moved to POST https://api.firecrawl.dev/v2/scrape
// (the plan's draft v1 path is stale). Response shape is
// { success, data: { markdown, links, metadata } }.

const { extractDistinctQuotedSentences } = require('./gather-stack')

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

// Our own domain(s) - always allowed. Outbound URLs are only allowed when
// they are already present in the caller-supplied allowedOutboundLinks list
// (i.e. links our own stack already cites), never derived by guessing.
const OUR_DOMAINS = Object.freeze(['cryptokiller.org'])

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function isOwnDomain(url) {
  const host = hostnameOf(url)
  if (!host) return false
  return OUR_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * A URL may be scraped only when it is our own domain, or when it already
 * appears in allowedOutboundLinks - an outbound URL already linked from a
 * page we control (e.g. a primary source cited in a published review). Any
 * other URL, including a competitor picked from a fresh SERP, is rejected.
 */
function isAllowedFirecrawlUrl(url, allowedOutboundLinks = []) {
  if (typeof url !== 'string' || !url.trim()) return false
  if (isOwnDomain(url)) return true
  return Array.isArray(allowedOutboundLinks) && allowedOutboundLinks.includes(url)
}

async function scrapeUrl(url, apiKey, fetchImpl) {
  const res = await fetchImpl(FIRECRAWL_SCRAPE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown', 'links'] }),
  })
  if (!res || !res.ok) {
    const status = res ? res.status : 'no response'
    throw new Error(`Firecrawl scrape failed for ${url}: ${status}`)
  }
  const json = await res.json()
  const data = json && typeof json === 'object' ? json.data || {} : {}
  return {
    url,
    markdown: typeof data.markdown === 'string' ? data.markdown : '',
    links: Array.isArray(data.links) ? data.links : [],
  }
}

/**
 * @param urls string[] candidate URLs to scrape (already-known, not fresh SERP picks)
 * @param apiKey optional explicit key; falls back to process.env.FIRECRAWL_API_KEY.
 *   When neither is set, returns { skipped: true } without throwing.
 * @param fetchImpl fetch-like function (defaults to global fetch)
 * @param allowedOutboundLinks outbound URLs already linked from our own pages;
 *   a candidate URL not on our domain and not in this list is silently dropped,
 *   never scraped.
 * @returns { pages: Array<{ url, markdown, links }>, error?: string, skipped?: true }
 */
async function gatherFirecrawlEvidence({ urls, apiKey, fetchImpl, allowedOutboundLinks = [] } = {}) {
  const key = apiKey || process.env.FIRECRAWL_API_KEY
  if (!key) return { skipped: true }

  const candidates = Array.isArray(urls) ? urls : []
  const allowed = candidates.filter((u) => isAllowedFirecrawlUrl(u, allowedOutboundLinks))
  if (allowed.length === 0) return { pages: [] }

  const impl = typeof fetchImpl === 'function' ? fetchImpl : typeof fetch === 'function' ? fetch : null
  if (!impl) return { pages: [], error: 'No fetch implementation available' }

  const pages = []
  const errors = []
  for (const url of allowed) {
    try {
      pages.push(await scrapeUrl(url, key, impl))
    } catch (e) {
      errors.push(e.message)
    }
  }

  const result = { pages }
  if (errors.length) result.error = errors.join('; ')
  return result
}

/**
 * Fills only the fields a stack gather (gather-stack.js) already reported as
 * missing, and only from quoted sentences on the scraped markdown - never
 * anything structural like entity_id, sub_entities, or internal_link_targets,
 * which stay stack-only per the honesty rule. Requires >=3 distinct quotes
 * across all scraped pages combined; anything short of that is left missing
 * rather than padded with fewer, weaker quotes.
 *
 * @param stackResult the { content_type, forcing_inputs, sources, missing }
 *   shape returned by gather-stack.js's gatherStackEvidence
 * @param firecrawlPages Array<{ url, markdown, links }> from gatherFirecrawlEvidence
 * @param contentType optional override of stackResult.content_type
 * @returns same shape as gatherStackEvidence
 */
function mergeFirecrawlIntoEvidence(stackResult, firecrawlPages, contentType) {
  const base = stackResult && typeof stackResult === 'object' ? stackResult : {}
  const result = {
    content_type: base.content_type || contentType || null,
    forcing_inputs: { ...(base.forcing_inputs || {}) },
    sources: [...(base.sources || [])],
    missing: [...(base.missing || [])],
  }

  if (!result.missing.includes('direct_anecdotes')) return result
  if (!Array.isArray(firecrawlPages) || firecrawlPages.length === 0) return result

  const quotes = []
  const seen = new Set()
  const sourcesToAdd = []
  for (const page of firecrawlPages) {
    const found = extractDistinctQuotedSentences(page?.markdown)
    for (const quote of found) {
      const key = quote.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      quotes.push(quote)
      sourcesToAdd.push({ url: page?.url || null, field: 'direct_anecdotes', quote })
    }
  }

  if (quotes.length < 3) return result // never pad below the 3-quote minimum

  result.forcing_inputs.direct_anecdotes = quotes
  result.sources.push(...sourcesToAdd)
  result.missing = result.missing.filter((field) => field !== 'direct_anecdotes')
  return result
}

module.exports = {
  gatherFirecrawlEvidence,
  mergeFirecrawlIntoEvidence,
  isAllowedFirecrawlUrl,
  FIRECRAWL_SCRAPE_URL,
}
