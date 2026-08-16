'use strict'

/**
 * Quality-fix research escalation: ask a grounded model for sources that
 * support load-bearing claims, then keep only HEAD-verified URLs.
 *
 * Never invents URLs in this module — the model may propose; we filter.
 * Never returns a source that failed verification.
 */

const { extractJSON } = require('./ai-models')
const { headCheckUrl, verifySourceLedger } = require('./source-verify')

function claimText(claim) {
  if (typeof claim === 'string') return claim.trim()
  if (claim && typeof claim.text === 'string') return claim.text.trim()
  return ''
}

function normalizeExistingUrls(existingUrls) {
  if (existingUrls instanceof Set) return existingUrls
  if (Array.isArray(existingUrls)) return new Set(existingUrls.filter((u) => typeof u === 'string' && u))
  return new Set()
}

function buildResearchPrompt({ claims, topicTitle, existingUrls }) {
  const claimLines = claims
    .map(claimText)
    .filter(Boolean)
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n')

  const excludeLines = Array.from(existingUrls)
    .map((u) => `  - ${u}`)
    .join('\n')

  const system = [
    'You are a YMYL source researcher for Crypto Killer.',
    'Return ONLY valid JSON. No markdown fences, no prose outside JSON.',
    'Propose real, publicly reachable URLs that support the listed claims.',
    'Prefer government, regulator, and high-authority consumer-protection sources.',
    'Do not invent URLs. If you cannot find a real source for a claim, omit it.',
  ].join(' ')

  const user = [
    `Topic: ${topicTitle || 'crypto scam investigation'}`,
    '',
    'Claims that need supporting sources:',
    claimLines || '(none)',
    '',
    'Exclude these URLs (already on the page):',
    excludeLines || '  (none)',
    '',
    'Respond with JSON exactly shaped as:',
    JSON.stringify({
      sources: [
        {
          url: 'https://example.gov/page',
          title: 'Source title',
          type: 'government',
          extract: 'Short quote or fact the URL supports',
        },
      ],
    }),
  ].join('\n')

  return { system, user }
}

function shapeSource(entry) {
  const url = typeof entry?.url === 'string' ? entry.url.trim() : ''
  const title = typeof entry?.title === 'string' ? entry.title.trim() : ''
  if (!url || !title) return null
  return {
    url,
    title,
    type: typeof entry?.type === 'string' && entry.type.trim() ? entry.type.trim() : 'other',
    extract: typeof entry?.extract === 'string' ? entry.extract : '',
  }
}

/**
 * Research sources for load-bearing claims via grounded model + HEAD verify.
 *
 * @param {object} opts
 * @param {Array<{text?: string}|string>} opts.claims
 * @param {string} opts.topicTitle
 * @param {Set<string>|string[]} opts.existingUrls
 * @param {Function} opts.callModelFn - production: callModel from ai-models
 * @param {Function} [opts.headCheckFn] - defaults to headCheckUrl from source-verify
 * @returns {Promise<{sources: Array, rejected: Array}>}
 */
async function researchSourcesForClaims({
  claims = [],
  topicTitle = '',
  existingUrls,
  callModelFn,
  headCheckFn = headCheckUrl,
} = {}) {
  if (typeof callModelFn !== 'function') {
    throw new Error('callModelFn is required')
  }

  const existing = normalizeExistingUrls(existingUrls)
  const claimList = Array.isArray(claims) ? claims : []
  const { system, user } = buildResearchPrompt({
    claims: claimList,
    topicTitle,
    existingUrls: existing,
  })

  const result = await callModelFn('gemini-flash', system, user, {
    searchGrounding: true,
    jsonMode: true,
    label: 'quality-fix-research',
  })

  let parsed
  try {
    parsed = extractJSON(result?.text || '')
  } catch {
    return { sources: [], rejected: [] }
  }

  const raw = Array.isArray(parsed?.sources) ? parsed.sources : []
  const candidates = []
  const rejected = []
  const seen = new Set()

  for (const entry of raw) {
    const shaped = shapeSource(entry)
    if (!shaped) {
      rejected.push({ source: entry || null, reason: 'missing url or title' })
      continue
    }
    if (existing.has(shaped.url) || seen.has(shaped.url)) {
      rejected.push({ source: shaped, reason: 'duplicate or already on page' })
      continue
    }
    seen.add(shaped.url)
    candidates.push(shaped)
  }

  // Prefer ledger verification when using the default source-verify HEAD check
  // (same underlying headCheckUrl). Custom headCheckFn (tests) uses the loop.
  if (headCheckFn === headCheckUrl && candidates.length > 0) {
    const { verified, dropped } = await verifySourceLedger(candidates)
    const sources = verified
      .filter((s) => s && s.verified === true)
      .map((s) => ({
        url: s.url,
        title: s.title,
        type: s.type || 'other',
        extract: typeof s.extract === 'string' ? s.extract : '',
      }))
    for (const d of dropped) {
      rejected.push({
        source: d.source,
        reason: d.reason || 'head check failed',
      })
    }
    // Soft-kept generics with verified:false must not ship
    for (const s of verified) {
      if (s && s.verified === false) {
        rejected.push({
          source: { title: s.title, url: s.url, type: s.type },
          reason: 'unverified after ledger check',
        })
      }
    }
    return { sources, rejected }
  }

  const sources = []
  for (const candidate of candidates) {
    let check
    try {
      check = await headCheckFn(candidate.url)
    } catch (e) {
      check = { ok: false, reason: `check threw: ${e?.message || e}` }
    }
    if (check && check.ok) {
      sources.push(candidate)
    } else {
      rejected.push({
        source: { title: candidate.title, url: candidate.url, type: candidate.type },
        reason: (check && check.reason) || 'head check failed',
      })
    }
  }

  return { sources, rejected }
}

/**
 * Append verified sources onto a content/review row without URL duplicates.
 * Preserves citations when present on the row.
 *
 * @param {object} row
 * @param {Array<{url:string,title?:string,type?:string,extract?:string}>} sources
 * @returns {{ sources: Array, citations?: Array }}
 */
function mergeVerifiedSources(row, sources) {
  const base = Array.isArray(row?.sources) ? row.sources.map((s) => ({ ...s })) : []
  const seen = new Set(base.map((s) => s && s.url).filter(Boolean))
  const incoming = Array.isArray(sources) ? sources : []

  for (const s of incoming) {
    if (!s || typeof s.url !== 'string' || !s.url) continue
    if (seen.has(s.url)) continue
    seen.add(s.url)
    base.push({ ...s })
  }

  const out = { sources: base }
  if (Array.isArray(row?.citations)) {
    out.citations = row.citations.map((c) => ({ ...c }))
  }
  return out
}

module.exports = {
  researchSourcesForClaims,
  mergeVerifiedSources,
}
