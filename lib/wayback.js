/**
 * lib/wayback.js
 *
 * Minimal wrapper for the Internet Archive's Wayback Machine Save API.
 * Used by /api/cron/archive-landing-pages to capture a persistent
 * snapshot of every distinct scam landing URL we pull off SpyOwl, so
 * ClaimReview.appearance on the live cryptokiller.org schema can cite
 * a durable, non-trafficking URL rather than the scam's own site.
 *
 * API contract (observed; not publicly documented beyond the homepage):
 *   POST https://web.archive.org/save/<url-to-archive>
 *     - Body: none required for anonymous captures
 *     - Content-Location response header: /web/<timestamp>/<url> when
 *       the save succeeded. Prepend the origin to get the public archive
 *       URL: `https://web.archive.org/web/<timestamp>/<url>`.
 *     - Status: 200 on accepted capture, 429 on rate-limit, 5xx on
 *       infra failure. 523 (Origin Unreachable) is semi-common when the
 *       scam's domain has already been taken down — treat as permanent
 *       failure, don't retry.
 *
 * Anonymous rate limit is roughly 15 captures/minute per IP.  This module
 * self-rate-limits at 1 call per 6 seconds (10/min) so we stay well
 * under and don't compete with organic users. For larger volumes we'd
 * need an S3-style API key; deferred until pain shows up.
 *
 * Never throws on network/HTTP failure — returns { status, error } so
 * the caller can record failure in brand_landing_pages.last_error
 * without an exception unwinding the cron's loop.
 */

const WAYBACK_ORIGIN = 'https://web.archive.org'
const WAYBACK_SAVE_TIMEOUT_MS = 30_000

// Soft rate-limit state kept at module scope. On Vercel each function
// invocation gets its own module instance, so this protects within a
// single cron run but not across concurrent runs — the Wayback server's
// own 429 handling catches anything we missed.
let _lastSaveAt = 0
const MIN_INTERVAL_MS = 6_000

/**
 * Sleep for N milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Gate to the rate limit. Call immediately before every fetch.
 */
async function rateLimit() {
  const now = Date.now()
  const sinceLast = now - _lastSaveAt
  if (sinceLast < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - sinceLast)
  }
  _lastSaveAt = Date.now()
}

/**
 * Extract a hostname from a URL string. Returns null on malformed input
 * rather than throwing — callers use this for dedup keys, never for
 * user-facing display.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractHostname(url) {
  if (typeof url !== 'string' || !url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Request a Wayback capture of `url`. Returns a normalised result
 * regardless of failure mode so the caller can persist it.
 *
 * @param {string} url - the URL to capture (must be absolute http(s))
 * @returns {Promise<{
 *   status: 'success' | 'failed' | 'rate_limited',
 *   archiveUrl: string | null,
 *   httpStatus: number | null,
 *   error: string | null
 * }>}
 */
export async function saveToWayback(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { status: 'failed', archiveUrl: null, httpStatus: null, error: 'Invalid URL' }
  }

  await rateLimit()

  const saveUrl = `${WAYBACK_ORIGIN}/save/${url}`

  let res
  try {
    res = await fetch(saveUrl, {
      method: 'POST',
      // Wayback's anonymous flow doesn't accept a body and some proxies
      // strip it anyway. Redirect: follow so the 302 → archive URL chain
      // resolves on the server side; we still read Content-Location off
      // the final response for the canonical snapshot URL.
      redirect: 'follow',
      signal: AbortSignal.timeout(WAYBACK_SAVE_TIMEOUT_MS),
      headers: {
        // User-Agent: Wayback blocks obvious bot strings; a descriptive
        // identifier makes support cases easier if we ever need them.
        'User-Agent': 'CryptoKiller-Archiver/1.0 (+https://cryptokiller.org)',
      },
    })
  } catch (err) {
    return {
      status: 'failed',
      archiveUrl: null,
      httpStatus: null,
      error: `fetch: ${err?.message || String(err)}`.slice(0, 500),
    }
  }

  const httpStatus = res.status

  if (httpStatus === 429) {
    return { status: 'rate_limited', archiveUrl: null, httpStatus, error: 'Wayback 429' }
  }

  if (httpStatus < 200 || httpStatus >= 400) {
    // 523 ("Origin Unreachable") usually means the scam domain is dead
    // — tag as failed so the cron stops retrying after attempts > 5.
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch {}
    return {
      status: 'failed',
      archiveUrl: null,
      httpStatus,
      error: `HTTP ${httpStatus}${body ? ': ' + body : ''}`.slice(0, 500),
    }
  }

  // Success path. Wayback returns Content-Location like:
  //   /web/20260424093012/https://example.com/page
  // When followed all the way through, res.url is often the absolute
  // archive URL already. Prefer Content-Location header (authoritative)
  // but fall back to res.url if the header is stripped by a proxy.
  const contentLocation = res.headers.get('content-location')
  let archiveUrl = null
  if (contentLocation && contentLocation.startsWith('/web/')) {
    archiveUrl = `${WAYBACK_ORIGIN}${contentLocation}`
  } else if (res.url && res.url.includes('/web/')) {
    archiveUrl = res.url
  }

  if (!archiveUrl) {
    // No parseable snapshot URL. This happens occasionally when Wayback
    // has the page already but returns 200 without Content-Location on a
    // cold-path response. Synthesize a canonical /web/<timestamp>/<url>
    // using the current UTC timestamp — it'll resolve to the most recent
    // capture via Wayback's redirect chain on next access.
    const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14) // YYYYMMDDHHMMSS
    archiveUrl = `${WAYBACK_ORIGIN}/web/${ts}/${url}`
  }

  return { status: 'success', archiveUrl, httpStatus, error: null }
}
