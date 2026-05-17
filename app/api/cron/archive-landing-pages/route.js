import { supaFetch } from '@/lib/supabase'
import { saveToWayback, extractHostname } from '@/lib/wayback'

/**
 * GET /api/cron/archive-landing-pages
 *
 * Daily pass that walks scam_brands.landing_urls[] (populated by
 * migration 005's rebuild_brands aggregate), and for every URL that
 * hasn't been captured within STALE_DAYS calls the Wayback Save API
 * and records the result in brand_landing_pages.
 *
 * Why a cron (not on-scrape): Wayback's anonymous rate limit is ~15
 * captures/min and the scraper runs hundreds of upserts per second.
 * Running capture inline would pin the scraper to Wayback's tempo and
 * wipe out its own performance characteristics. Running out-of-band lets
 * both jobs operate at their natural speed.
 *
 * Scoping heuristics:
 *   * Only brands with scam_score >= SCORE_THRESHOLD are archived. Low-
 *     signal brands aren't publish-candidates and every skipped URL saves
 *     a Wayback call (and our rate-limit budget).
 *   * Within a brand, only the newest MAX_URLS_PER_BRAND landing URLs
 *     are considered — scam brands cycle campaign URLs weekly, so older
 *     entries are either already dead or already archived from a prior
 *     cron pass.
 *   * Hostname-level dedup: if any URL on the same hostname was
 *     successfully captured within STALE_DAYS, skip — the page itself
 *     probably hasn't changed, just tracking params.
 *   * Per-run cap (CAPTURES_PER_RUN): keeps one cron invocation within
 *     Vercel's maxDuration window. Anything not captured today rolls
 *     over to tomorrow's pass.
 *
 * Idempotent. Safe to re-run. URLs that fail with attempts >= MAX_ATTEMPTS
 * are left alone (takedown, unreachable, dead).
 *
 * Auth: Vercel Cron sends Authorization: Bearer CRON_SECRET. Manual admin
 * runs can use CRON_SECRET or ADMIN_SECRET for backward compat, matching
 * the polish-watchdog route.
 */

const STALE_DAYS = 30
const SCORE_THRESHOLD = 40        // skip 'watchlist' and below
const MAX_URLS_PER_BRAND = 3      // newest 3 URLs per brand per pass
const CAPTURES_PER_RUN = 100      // ~10 min at 6s rate-limit (we cap at 300s maxDuration)
const MAX_ATTEMPTS = 5

export const maxDuration = 300

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  const isCron = scheme === 'Bearer'
    && !!process.env.CRON_SECRET
    && token === process.env.CRON_SECRET
  const isAdmin = scheme === 'Bearer'
    && !!process.env.ADMIN_SECRET
    && token === process.env.ADMIN_SECRET

  if (!isCron && !isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const result = {
    scanned_brands: 0,
    candidate_urls: 0,
    skipped_existing: 0,
    skipped_hostname_dedup: 0,
    skipped_dead: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    rate_limited: 0,
    errors: [],
  }

  try {
    // Fetch candidate brands. Filter in-query on scam_score + non-empty
    // landing_urls to avoid paging through 22k rows just to throw away
    // the ones we'd skip. `order=scam_score.desc` so the highest-risk
    // brands get archived first if CAPTURES_PER_RUN trims the tail.
    const brands = await supaFetch(
      `/scam_brands?scam_score=gte.${SCORE_THRESHOLD}` +
      `&landing_urls=not.eq.{}` +
      `&order=scam_score.desc` +
      `&select=id,slug,scam_score,landing_urls`
    )

    if (!Array.isArray(brands) || brands.length === 0) {
      return Response.json({
        success: true,
        duration_ms: Date.now() - startedAt,
        message: 'No candidate brands with landing_urls above score threshold',
        ...result,
      })
    }

    result.scanned_brands = brands.length

    // Pull existing captures in one query so the inner loop doesn't do
    // per-URL round-trips. Includes failed + rate_limited so we skip
    // brands already-dead too (attempts >= MAX_ATTEMPTS).
    const staleCutoffIso = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString()
    const existing = await supaFetch(
      `/brand_landing_pages?select=id,brand_id,live_url,live_hostname,archive_status,captured_at,attempts`
    ) || []

    // Indexes: by live_url for exact match; by hostname for dedup.
    const byUrl = new Map()
    const byHostRecent = new Map() // hostname -> most recent success captured_at
    for (const row of existing) {
      byUrl.set(row.live_url, row)
      if (row.archive_status === 'success' && row.live_hostname && row.captured_at) {
        const prev = byHostRecent.get(row.live_hostname)
        if (!prev || row.captured_at > prev) byHostRecent.set(row.live_hostname, row.captured_at)
      }
    }

    // Walk brands highest-score-first, capturing up to CAPTURES_PER_RUN URLs.
    outer: for (const brand of brands) {
      const urls = Array.isArray(brand.landing_urls)
        ? brand.landing_urls.slice(0, MAX_URLS_PER_BRAND)
        : []
      for (const url of urls) {
        if (result.attempted >= CAPTURES_PER_RUN) break outer
        result.candidate_urls++

        const hostname = extractHostname(url)

        // Skip if this exact URL has a recent capture. archive_status
        // may be success/failed/rate_limited — the attempts guard
        // below handles dead URLs.
        const existingRow = byUrl.get(url)
        if (existingRow) {
          // Dead URL: too many attempts, give up permanently.
          if ((existingRow.attempts ?? 0) >= MAX_ATTEMPTS) {
            result.skipped_dead++
            continue
          }
          // Recently captured (success or not) within STALE_DAYS: skip.
          if (existingRow.captured_at && existingRow.captured_at > staleCutoffIso) {
            result.skipped_existing++
            continue
          }
        }

        // Hostname-level dedup: if we've captured any URL on this host
        // within STALE_DAYS, skip — scams rotate tracking params but
        // the page body is the same.
        if (hostname) {
          const hostLast = byHostRecent.get(hostname)
          if (hostLast && hostLast > staleCutoffIso) {
            result.skipped_hostname_dedup++
            continue
          }
        }

        result.attempted++

        const capture = await saveToWayback(url)

        if (capture.status === 'success') result.succeeded++
        else if (capture.status === 'rate_limited') result.rate_limited++
        else result.failed++

        // Persist via upsert on live_url. Increment attempts even on
        // success so the column is a reliable "total captures ever"
        // counter for debugging dead URLs.
        const attempts = (existingRow?.attempts ?? 0) + 1
        const body = {
          brand_id: brand.id,
          live_url: url,
          live_hostname: hostname,
          archive_url: capture.archiveUrl ?? (existingRow?.archive_url ?? null),
          archive_status: capture.status,
          captured_at: new Date().toISOString(),
          http_status: capture.httpStatus,
          attempts,
          last_error: capture.error ? capture.error.slice(0, 500) : null,
        }

        try {
          await supaFetch('/brand_landing_pages?on_conflict=live_url', {
            method: 'POST',
            headers: {
              'Prefer': 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(body),
          })
        } catch (e) {
          // Persistence failure doesn't abort the loop; record it so we
          // can diagnose, and let the next run retry.
          result.errors.push({ url, error: (e && e.message) ? e.message.slice(0, 200) : String(e).slice(0, 200) })
        }

        // Hostname-dedup ratchet forward on success so subsequent URLs
        // on the same host within this run also skip.
        if (capture.status === 'success' && hostname) {
          byHostRecent.set(hostname, body.captured_at)
        }

        // Rate-limited responses are a signal to back off entirely on
        // this run; Wayback clocks recover over minutes.
        if (capture.status === 'rate_limited') {
          break outer
        }
      }
    }

    return Response.json({
      success: true,
      duration_ms: Date.now() - startedAt,
      thresholds: {
        stale_days: STALE_DAYS,
        score_threshold: SCORE_THRESHOLD,
        max_urls_per_brand: MAX_URLS_PER_BRAND,
        captures_per_run: CAPTURES_PER_RUN,
        max_attempts: MAX_ATTEMPTS,
      },
      ...result,
    })
  } catch (error) {
    console.error('[archive-landing-pages] error:', error)
    return Response.json(
      {
        error: error?.message || 'Archive cron failed',
        duration_ms: Date.now() - startedAt,
        ...result,
      },
      { status: 500 }
    )
  }
}
