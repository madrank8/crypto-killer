/**
 * Pure helpers for review → Replit sync safety (Peak Luxentria audit 2026-08-10).
 *
 * Kept free of path aliases so `node --test` can load this module without a
 * bundler. sync-shape.js calls these during shapeReviewForSync.
 */

'use strict'

/** Replit appends " | CryptoKiller" (~15 chars) to <title>; budget the bare title. */
const SEO_TITLE_MAX = 45
const META_DESCRIPTION_MAX = 155

const AGGREGATOR_HOSTS = new Set([
  'trustpilot.com',
  'www.trustpilot.com',
  'sitejabber.com',
  'www.sitejabber.com',
  'scamadviser.com',
  'www.scamadviser.com',
  'bbb.org',
  'www.bbb.org',
  'ripoffreport.com',
  'www.ripoffreport.com',
  'scamdoc.com',
  'www.scamdoc.com',
  'scam-detector.com',
  'www.scam-detector.com',
])

/**
 * Boundary-aware truncation (mirrors sync-shape truncateAtBoundary).
 * @param {string} input
 * @param {number} max
 */
function truncateAtBoundary(input, max) {
  const s = String(input || '').trim()
  if (s.length <= max) return s
  let cut = s.slice(0, max + 1)
  const lastSpace = cut.lastIndexOf(' ')
  cut = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut.slice(0, max)).trim()
  for (let i = 0; i < 3; i++) {
    cut = cut
      .replace(/[\s,;:—–\-|&/+.]+$/g, '')
      .replace(/\s+(?:and|or|of|the|for|with|a|an|in|to|vs|by|on|at|from|is|are)$/i, '')
      .trim()
  }
  return cut
}

/**
 * True when a URL is a live ad-tracking / funnel redirect that must never
 * appear as a public "View archived ad" CTA.
 * @param {string} url
 */
function isUnsafeLandingUrl(url) {
  if (!url || typeof url !== 'string') return false
  let u
  try {
    u = new URL(url)
  } catch {
    return /fbclid=|token_fb=|pixel_fb=|\/click\?/i.test(url)
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  const pathq = `${u.pathname}${u.search}`.toLowerCase()
  if (/[?&](fbclid|token_fb|pixel_fb|ad_id|adset_id)=/i.test(u.search)) return true
  if (/\/click(?:\/|\?|$)/i.test(pathq)) return true
  // Meta conversion-tracking landers commonly use these path shapes
  if (/\/(?:cltr|track|go|out|redirect)(?:\/|\?|$)/i.test(pathq) && /utm_source=fb/i.test(u.search)) {
    return true
  }
  // facebook.com posts are safe; facebook.com/ads/library is safe
  if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    return false
  }
  return false
}

/**
 * True when url is a Facebook post permalink suitable as a public CTA.
 * @param {string} url
 */
function isSafeFacebookPostUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    if (host !== 'facebook.com' && host !== 'fb.com' && !host.endsWith('.facebook.com')) {
      return false
    }
    // Ad Library is also allowed as a CTA target
    if (u.pathname.toLowerCase().includes('/ads/library')) return true
    // Posts / videos / reels / photo links
    return /\/(posts|videos|reel|watch|permalink|photo|story)\b/i.test(u.pathname)
      || /\/profile\.php/i.test(u.pathname)
      || /story_fbid=/i.test(u.search)
  } catch {
    return false
  }
}

/**
 * Meta Ad Library search URL for a brand name (no funnel hop).
 * @param {string} brandName
 */
function buildMetaAdLibraryUrl(brandName) {
  const q = String(brandName || '').trim()
  if (!q) return null
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${encodeURIComponent(q)}`
}

/**
 * Build a safe public CTA for a recent-ad card.
 * Policy: Facebook post_url → Ad Library search → omit.
 * @param {{ post_url?: string|null, brandName?: string|null }} opts
 */
function safeAdCta({ post_url, brandName } = {}) {
  if (post_url && isSafeFacebookPostUrl(post_url) && !isUnsafeLandingUrl(post_url)) {
    return {
      cta_url: post_url,
      cta_label: 'View Facebook post',
      cta_rel: 'nofollow noopener',
    }
  }
  const library = buildMetaAdLibraryUrl(brandName)
  if (library) {
    return {
      cta_url: library,
      cta_label: 'View in Meta Ad Library',
      cta_rel: 'nofollow noopener',
    }
  }
  return { cta_url: null, cta_label: null, cta_rel: null }
}

/**
 * Shape one recent-ad row for the sync payload. Never includes link_url.
 * @param {object} a
 * @param {{ brandName?: string }} [opts]
 */
function shapeRecentAdForSync(a, opts = {}) {
  let linkDomain = null
  try {
    if (a?.link_url) linkDomain = new URL(a.link_url).hostname
  } catch { /* malformed */ }

  const mainText = typeof a?.main_text === 'string'
    ? (a.main_text.length > 280 ? a.main_text.slice(0, 277) + '…' : a.main_text)
    : null

  const cta = safeAdCta({ post_url: a?.post_url, brandName: opts.brandName })

  return {
    creative_id: a?.creative_id || a?.id,
    offer_name: a?.offer_name,
    celebrity_name: a?.celebrity_name || null,
    geo: a?.geo,
    land_language: a?.land_language || null,
    is_video: !!a?.is_video,
    first_seen_at: a?.first_seen_at,
    spyowl_created_at: a?.spyowl_created_at || a?.created_at,
    main_text: mainText,
    link_text: a?.link_text || null,
    link_domain: linkDomain,
    post_url: a?.post_url || null,
    fp_link: a?.fp_link || null,
    cta_url: cta.cta_url,
    cta_label: cta.cta_label,
    cta_rel: cta.cta_rel,
  }
}

/**
 * True if any string field in a shaped recent-ad sample is an unsafe landing URL.
 * @param {object} shaped
 */
function shapedAdHasUnsafeUrl(shaped) {
  if (!shaped || typeof shaped !== 'object') return false
  for (const v of Object.values(shaped)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && isUnsafeLandingUrl(v)) {
      return true
    }
  }
  return false
}

/**
 * Remove Key Takeaways / FAQ blocks from full_article when structured fields
 * already carry them (prevents double-render with Replit components).
 * @param {string} html
 * @param {{ hasKeyTakeaways?: boolean, hasFaq?: boolean }} flags
 */
function stripStructuredDupesFromArticle(html, flags = {}) {
  let out = typeof html === 'string' ? html : ''
  if (!out) return out

  const hasTakeaways = flags.hasKeyTakeaways !== false
  const hasFaq = flags.hasFaq !== false

  if (hasTakeaways) {
    // Class-based speakable block
    out = out.replace(
      /<div\b[^>]*\bclass=["'][^"']*\bkey-takeaways\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      '',
    )
    // Styled section / heading variants (emoji optional)
    out = out.replace(
      /<(?:section|div)\b[^>]*>\s*<h[23][^>]*>[\s\S]*?Key Takeaways[\s\S]*?<\/h[23]>[\s\S]*?<\/(?:section|div)>/gi,
      '',
    )
    out = out.replace(
      /<h[23][^>]*>[\s\S]*?Key Takeaways[\s\S]*?<\/h[23]>\s*(?:<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>)?/gi,
      '',
    )
  }

  if (hasFaq) {
    out = out.replace(
      /<div\b[^>]*\bclass=["'][^"']*\bfaq-section\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      '',
    )
    out = out.replace(
      /<(?:section|div)\b[^>]*>\s*<h[23][^>]*>[\s\S]*?Frequently Asked Questions[\s\S]*?<\/h[23]>[\s\S]*?<\/(?:section|div)>/gi,
      '',
    )
    // Heading whose OWN text contains FAQ, then content until next H2.
    // Do not start matching at an earlier H2 (that deleted Evidence on Peak).
    out = out.replace(
      /<h2\b[^>]*>((?:(?!<\/h2>)[\s\S])*Frequently Asked Questions(?:(?!<\/h2>)[\s\S])*)<\/h2>[\s\S]*?(?=<h2\b|$)/gi,
      '',
    )
  }

  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Reject review-aggregator URLs as itemReviewed.url.
 * @param {string|null} url
 * @param {{ brandOrigin?: string|null }} [opts]
 * @returns {string|null}
 */
function sanitizeItemReviewedUrl(url, opts = {}) {
  const brandOrigin = opts.brandOrigin || null
  if (typeof url === 'string' && url.startsWith('http')) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
      const fullHost = new URL(url).hostname.toLowerCase()
      if (AGGREGATOR_HOSTS.has(fullHost) || AGGREGATOR_HOSTS.has(host) || AGGREGATOR_HOSTS.has(`www.${host}`)) {
        // fall through to brand origin
      } else if (!isUnsafeLandingUrl(url)) {
        return url
      }
    } catch {
      /* fall through */
    }
  }
  if (typeof brandOrigin === 'string' && brandOrigin.startsWith('http') && !isUnsafeLandingUrl(brandOrigin)) {
    try {
      const u = new URL(brandOrigin)
      // Prefer origin only (no /click path)
      if (/\/click/i.test(u.pathname)) return null
      return `${u.protocol}//${u.host}/`
    } catch {
      return null
    }
  }
  return null
}

/**
 * Pick a brand website origin from landing URL list (skip trackers).
 * @param {string[]} landingUrls
 * @returns {string|null}
 */
function pickBrandOrigin(landingUrls) {
  if (!Array.isArray(landingUrls)) return null
  for (const raw of landingUrls) {
    if (typeof raw !== 'string' || !raw.startsWith('http')) continue
    if (isUnsafeLandingUrl(raw)) continue
    try {
      const u = new URL(raw)
      if (/\/click/i.test(u.pathname)) continue
      return `${u.protocol}//${u.host}/`
    } catch { /* next */ }
  }
  return null
}

/**
 * Plain-text word count from HTML (schema/byline source of truth).
 * @param {string} html
 */
function countPlainWords(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Compose SEO-safe title/meta for sync (Replit must not hard-slice headline).
 * @param {{ title?: string, meta?: string }} fields
 */
function composeSeoFields({ title, meta } = {}) {
  const seo_title = truncateAtBoundary(title || '', SEO_TITLE_MAX)
  const meta_description = truncateAtBoundary(meta || '', META_DESCRIPTION_MAX)
  return { seo_title, title: seo_title, meta_description }
}

module.exports = {
  SEO_TITLE_MAX,
  META_DESCRIPTION_MAX,
  AGGREGATOR_HOSTS,
  truncateAtBoundary,
  isUnsafeLandingUrl,
  isSafeFacebookPostUrl,
  buildMetaAdLibraryUrl,
  safeAdCta,
  shapeRecentAdForSync,
  shapedAdHasUnsafeUrl,
  stripStructuredDupesFromArticle,
  sanitizeItemReviewedUrl,
  pickBrandOrigin,
  countPlainWords,
  composeSeoFields,
}
