import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { SPYOWL_API, getSpyOwlCookie } from '@/lib/scraper'

export const maxDuration = 30

/**
 * GET /api/admin/scraper/probe
 *
 * Diagnostic endpoint — fetches one (or a few) creatives from the SpyOwl API
 * and returns the raw JSON response unchanged. Lets us see EVERY field SpyOwl
 * exposes per creative, not just the subset lib/scraper.js currently persists.
 *
 * Use this when:
 *   - Designing schema extensions (e.g., adding image_url, video_url columns)
 *   - Debugging why a scraped creative is missing data
 *   - Verifying what new fields SpyOwl rolled out
 *
 * Query params:
 *   - limit (default 1, max 5) — number of creatives to return
 *   - skip  (default 0)        — offset into the SpyOwl result set
 *   - id    (optional)         — fetch a specific creative ID instead of a page
 *
 * Auth: Bearer ADMIN_SECRET (verifyAdmin). No public exposure.
 *
 * Response shape:
 *   { ok: true, count: <N>, sample_fields: [string], creatives: <raw SpyOwl payload> }
 *
 * Example:
 *   curl -H "Authorization: Bearer $ADMIN_SECRET" \
 *        https://crypto-killer.vercel.app/api/admin/scraper/probe
 *   curl -H "Authorization: Bearer $ADMIN_SECRET" \
 *        "https://crypto-killer.vercel.app/api/admin/scraper/probe?limit=3&skip=10"
 */
export async function GET(request) {
  try {
    verifyAdmin(request)

    const url = new URL(request.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '1', 10), 1), 5)
    const skip = Math.max(parseInt(url.searchParams.get('skip') || '0', 10), 0)
    const id = (url.searchParams.get('id') || '').trim()

    const cookie = await getSpyOwlCookie()
    if (!cookie) {
      return Response.json(
        { ok: false, error: 'No SpyOwl cookie configured in settings.spyowl_cookie' },
        { status: 503 }
      )
    }

    // Single-creative path
    if (id) {
      const res = await fetch(`${SPYOWL_API}/creative/${encodeURIComponent(id)}`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(15_000),
      })
      const text = await res.text()
      let body
      try { body = JSON.parse(text) } catch { body = text }
      return Response.json({
        ok: res.ok,
        status: res.status,
        endpoint: `${SPYOWL_API}/creative/${id}`,
        sample_fields: body && typeof body === 'object' ? Object.keys(body) : null,
        creative: body,
      })
    }

    // Page path — matches lib/scraper.js call signature
    const apiUrl = `${SPYOWL_API}/creative/all?skip=${skip}&limit=${limit}&pageType=all&creativeType=all`
    const res = await fetch(apiUrl, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }

    // Surface the top-level shape + field set of the first creative so we
    // can immediately see what's available without scrolling through the
    // full dump.
    let sampleFields = null
    let firstCreative = null
    if (body && Array.isArray(body.creatives) && body.creatives.length > 0) {
      firstCreative = body.creatives[0]
      sampleFields = Object.keys(firstCreative).sort()
    }

    return Response.json({
      ok: res.ok,
      status: res.status,
      endpoint: apiUrl,
      top_level_keys: body && typeof body === 'object' ? Object.keys(body) : null,
      sample_fields: sampleFields,
      first_creative: firstCreative,
      full: body,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
}
