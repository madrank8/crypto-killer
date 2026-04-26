import { revalidatePath } from 'next/cache'
import { supaFetch } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { shapeReviewForSync, normalizeBrandLandingUrls } from '@/lib/sync-shape'

// Supabase → Replit shape transform lives in lib/sync-shape.js, shared
// with the /sync route. That module handles field renames, funnel-stage
// parsing, stats assembly, geo region grouping, placeholder stripping.

// ─── Publish-time data integrity gates ───────────────────────────
//
// Four classes of bug have leaked to production on cryptokiller.org in
// the last month despite the writer / polish / sync-shape stages:
//
//   (1) Unresolved visual placeholders ([CHART NEEDED: …]) rendered as
//       body text on the published page. The polish stage substitutes
//       these when visual generation succeeds, but silently leaves them
//       when it doesn't — so a partial visual failure becomes visible.
//   (2) Fabricated citation URLs — reddit/quora URLs that follow the
//       real URL pattern but don't resolve. Pull-quotes from these URLs
//       end up in the Quotation schema, attributable to real subreddits
//       or authors. YMYL defamation risk.
//   (3) Malformed plural agreement ("1 countries", "1 days") that slips
//       past the writer prompt.
//   (4) Self-contradicting sentences in a single paragraph ("all 28
//       creatives target HK exclusively" + "28 distributed outside HK").
//
// This gate runs BEFORE we flip the row to status=published. A hard-
// gated failure returns 422 with a structured errors[] array the admin
// UI can render; non-fatal drift goes in warnings[] and is allowed
// through. The gate is skipped on unpublish.

const PLACEHOLDER_RE = /\[\s*(CHART|DIAGRAM|IMAGE|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED/i

// Domains we can't programmatically validate (block HEAD, hallucinate
// easily, or don't have a stable public URL scheme). Listing one of
// these in citations[] forces a manual-review path rather than an
// unverifiable auto-publish.
const UNVERIFIABLE_DOMAINS = new Set([
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com',
  'quora.com', 'www.quora.com',
  'medium.com', // anyone can publish; URLs hallucinate perfectly
  'twitter.com', 'x.com', // rate limits + requires auth
])

// Legit domains that commonly 403 a HEAD request — treat 403 as OK
// when the domain is on this allowlist. Otherwise 403 is a fail.
const HEAD_403_OK = new Set([
  'github.com', 'www.github.com',
  'linkedin.com', 'www.linkedin.com',
  'youtube.com', 'www.youtube.com',
  'amazon.com', 'www.amazon.com',
])

// Plural agreement errors that are almost never correct. Singular form
// goes in .detail for the error message. Applied to every prose field.
const PLURAL_MISMATCH_PATTERNS = [
  { re: /\b1\s+countries\b/i, detail: '1 country (singular)' },
  { re: /\b1\s+days\b/i, detail: '1 day (singular)' },
  { re: /\b1\s+creatives\b/i, detail: '1 creative (singular)' },
  { re: /\b1\s+celebrities\b/i, detail: '1 celebrity (singular)' },
  { re: /\b1\s+sources\b/i, detail: '1 source (singular)' },
  { re: /\b1\s+flags\b/i, detail: '1 flag (singular)' },
  { re: /\b1\s+platforms\b/i, detail: '1 platform (singular)' },
  { re: /\b1\s+brands\b/i, detail: '1 brand (singular)' },
  { re: /\b1\s+weeks\b/i, detail: '1 week (singular)' },
  { re: /\b1\s+months\b/i, detail: '1 month (singular)' },
  { re: /\b1\s+years\b/i, detail: '1 year (singular)' },
  { re: /\b1\s+victims\b/i, detail: '1 victim (singular)' },
]

const MIN_FULL_ARTICLE_WORDS = 700

/**
 * Collect every human-prose field on the review into one array so we
 * can run regex scans against the whole corpus at once. Keeps ordering
 * stable for deterministic error messages.
 */
function collectProseFields(review) {
  const fields = []
  const push = (label, val) => {
    if (typeof val === 'string' && val.trim()) fields.push({ label, text: val })
  }
  push('title', review.title)
  push('headline', review.headline)
  push('meta_description', review.meta_description)
  push('summary', review.summary)
  push('verdict', review.verdict)
  push('how_it_works', review.how_it_works)
  push('not_for_you', review.not_for_you)
  push('protection_steps', review.protection_steps)
  push('methodology', review.methodology)
  push('expertise_depth', review.expertise_depth)
  push('full_article', review.full_article)
  push('disclaimer', review.disclaimer)
  push('information_gain_summary', review.information_gain_summary)

  const redFlags = Array.isArray(review.red_flags) ? review.red_flags : []
  redFlags.forEach((rf, i) => {
    push(`red_flags[${i}].flag`, rf?.flag || rf?.title)
    push(`red_flags[${i}].detail`, rf?.detail || rf?.description)
  })
  const faq = Array.isArray(review.faq) ? review.faq : []
  faq.forEach((f, i) => {
    push(`faq[${i}].question`, f?.question)
    push(`faq[${i}].answer`, f?.answer)
  })
  const takeaways = Array.isArray(review.key_takeaways) ? review.key_takeaways : []
  takeaways.forEach((t, i) => push(`key_takeaways[${i}]`, typeof t === 'string' ? t : t?.text))

  return fields
}

/**
 * HEAD-check a single URL with a short timeout. Returns:
 *   { ok: true }
 *   { ok: false, reason: string }
 * We only fail on hard negatives: malformed URL, unverifiable domain,
 * DNS/network failure, non-2xx non-403 response (or 403 outside the
 * allowlist). Redirects are followed.
 */
async function headCheckUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'missing or non-string URL' }
  }
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return { ok: false, reason: `malformed URL (${url})` }
  }
  if (UNVERIFIABLE_DOMAINS.has(host)) {
    return {
      ok: false,
      reason:
        `unverifiable domain '${host}' — these URLs hallucinate perfectly ` +
        `and cannot be programmatically checked. Replace with a ` +
        `government/regulatory source, or remove.`,
    }
  }
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    })
    if (res.ok) return { ok: true }
    if (res.status === 403 && HEAD_403_OK.has(host)) return { ok: true }
    return { ok: false, reason: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, reason: `network: ${e.message || 'unknown error'}` }
  }
}

/**
 * Run every publish-time integrity gate on a review row. Returns:
 *   { errors: string[], warnings: string[] }
 * Non-empty errors[] blocks publish (422). warnings[] is informational
 * and rendered in the response but doesn't block.
 *
 * @param {object} review  — Supabase review row (full *, not shaped)
 */
async function validateReviewReadyToPublish(review) {
  const errors = []
  const warnings = []

  // ─── (1) Visual-placeholder leak check ─────────────────────────
  const fields = collectProseFields(review)
  for (const { label, text } of fields) {
    const m = text.match(PLACEHOLDER_RE)
    if (m) {
      const snippet = text.slice(m.index, m.index + 120).replace(/\s+/g, ' ')
      errors.push(
        `Unresolved visual placeholder in \`${label}\`: "${snippet}…" ` +
        `— polish pipeline did not substitute this placeholder before publish. ` +
        `Re-run /polish or remove the placeholder, then retry publish.`
      )
      break // one is enough
    }
  }

  // ─── (1b) full_article presence/quality gate ───────────────────
  // Published reviews must carry the writer-emitted long-form body.
  // Without this, Replit falls back to legacy template rendering.
  const fullArticle =
    typeof review.full_article === 'string' ? review.full_article.trim() : ''
  const fullArticleWords = fullArticle
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  if (fullArticleWords < MIN_FULL_ARTICLE_WORDS) {
    errors.push(
      `full_article is missing or too thin (words=${fullArticleWords}, min=${MIN_FULL_ARTICLE_WORDS}). ` +
      `Run AI Generate/Fill, save, and retry publish.`
    )
  }

  // ─── (2) Citation URL validation (HEAD + blocked-domain check) ─
  const citations = Array.isArray(review.citations) ? review.citations : []
  const sources = Array.isArray(review.sources) ? review.sources : []
  const urlsToCheck = [
    ...citations.map((c) => c?.url).filter(Boolean),
    ...sources.map((s) => s?.url).filter(Boolean),
  ]
  // Dedupe within the review (same URL in both citations+sources is common)
  const uniqueUrls = Array.from(new Set(urlsToCheck))
  if (uniqueUrls.length > 0) {
    const results = await Promise.allSettled(uniqueUrls.map((u) => headCheckUrl(u)))
    for (let i = 0; i < results.length; i++) {
      const url = uniqueUrls[i]
      const r = results[i]
      if (r.status === 'rejected') {
        errors.push(`Citation URL check threw: ${url} (${r.reason?.message || r.reason})`)
        continue
      }
      if (!r.value.ok) {
        errors.push(`Citation URL invalid — ${url}: ${r.value.reason}`)
      }
    }
  }

  // ─── (3) Plural agreement (warning, non-blocking) ──────────────
  const allText = fields.map((f) => f.text).join('\n')
  for (const p of PLURAL_MISMATCH_PATTERNS) {
    const m = allText.match(p.re)
    if (m) {
      warnings.push(`Plural mismatch: "${m[0]}" should be ${p.detail}.`)
    }
  }

  // ─── (4) Trivial self-contradiction heuristic (warning) ────────
  // Catches the most obvious cases — the full semantic check lives in
  // lib/sync-shape.js coherence guard on the sync path.
  const hkExclusive = /all\s+\d+\s+(?:ad\s+)?creatives?\s+target[^.]+?exclusively/i.test(allText)
  const hkOutside = /creatives?\s+distributed\s+outside/i.test(allText)
  if (hkExclusive && hkOutside) {
    warnings.push('Possible self-contradiction: text claims "all N creatives target X exclusively" AND "creatives distributed outside X" in the same review.')
  }

  return { errors, warnings }
}

/**
 * POST /api/admin/reviews/[id]/publish
 * Publish or unpublish a review
 * Body: { action: "publish" | "unpublish" }
 *
 * On publish: also syncs the review to the live site (Replit) via webhook
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)

    const { id } = await params
    const { action } = await request.json()

    if (!action || !['publish', 'unpublish'].includes(action)) {
      return Response.json(
        { error: 'Invalid action. Must be "publish" or "unpublish"' },
        { status: 400 }
      )
    }

    // Prepare update payload
    const updates = {}

    if (action === 'publish') {
      updates.status = 'published'
      updates.published_at = new Date().toISOString()
    } else {
      updates.status = 'draft'
      updates.published_at = null
    }

    updates.updated_at = new Date().toISOString()

    // Fetch the review for revalidation and sync
    const reviewData = await supaFetch(`/reviews?id=eq.${id}&select=*`)
    const review = Array.isArray(reviewData) ? reviewData[0] : null
    const reviewSlug = review?.slug

    // ─── INTEGRITY GATE (publish action only) ────────────────────
    // Block publish on unresolved placeholders or unverifiable citations.
    // Unpublish bypasses — we want an emergency unpublish to always work.
    if (action === 'publish' && review) {
      const gate = await validateReviewReadyToPublish(review)
      if (gate.errors.length > 0) {
        return Response.json(
          {
            error: 'Review failed publish-time integrity gate',
            reason: 'Fix the issues below and retry publish. This gate exists to keep fabricated sources and unresolved visual placeholders off the live site.',
            errors: gate.errors,
            warnings: gate.warnings,
            review_id: id,
          },
          { status: 422 }
        )
      }
      if (gate.warnings.length > 0) {
        // Warnings don't block. They ride along in the success response
        // so the admin UI can surface them after publish completes.
        console.warn(
          `[publish] review ${id} passed gate with ${gate.warnings.length} warning(s):`,
          gate.warnings
        )
        updates.fact_check_status = 'ai_generated_with_warnings'
      }
    }

    // Perform update
    await supaFetch(
      `/reviews?id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(updates),
      }
    )

    // Also mirror the publish state onto the linked scam_brand row.
    // The Replit live-site sync runs a two-phase job: Phase A walks
    // scam_brands and stamps each matching review's status from
    // brand.review_status. If we only flip reviews.status here, Phase A
    // will fight us on every cron tick and eventually win. Setting
    // scam_brands.review_status in the same moment makes both phases
    // agree. See the 2026-04-20 incident notes.
    if (review?.brand_id) {
      try {
        await supaFetch(
          `/scam_brands?id=eq.${review.brand_id}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              review_status: action === 'publish' ? 'published' : 'pending',
              updated_at: new Date().toISOString(),
            }),
          },
        )
      } catch (brandUpdateErr) {
        // Non-fatal — the review itself is already flipped. Log and move on.
        console.error('[publish] scam_brands.review_status mirror failed:', brandUpdateErr.message)
      }
    }

    // Revalidate cached pages so changes appear immediately
    try {
      if (reviewSlug) revalidatePath(`/review/${reviewSlug}`)
      revalidatePath('/')
      revalidatePath('/scams')
    } catch (revalError) {
      console.error('Revalidation error (non-fatal):', revalError.message)
    }

    // ─── SYNC TO LIVE SITE (publish + unpublish) ───
    let syncStatus = null
    if ((action === 'publish' || action === 'unpublish') && review) {
      const replitUrl = process.env.REPLIT_SITE_URL
      const syncSecret = process.env.SYNC_SECRET

      if (replitUrl && syncSecret) {
        try {
          // Fetch brand data
          let brand = null
          if (review.brand_id) {
            const brands = await supaFetch(
              `/scam_brands?id=eq.${review.brand_id}&select=*&limit=1`
            )
            brand = brands?.[0]
          }

          // Fetch Wayback snapshot URLs for this brand so claims[].appearance
          // cites archive URLs (zero traffic to scam domain, evidence
          // persists through takedowns) rather than the live scam URL.
          // Soft failure: if this errors or returns nothing, sync-shape
          // falls back to brand.landing_urls (live URLs) automatically.
          let landingUrls = []
          if (brand?.id) {
            try {
              const rows = await supaFetch(
                `/brand_landing_pages?brand_id=eq.${brand.id}` +
                  `&select=archive_url,archive_status,live_url,captured_at` +
                  `&order=captured_at.desc&limit=20`
              )
              landingUrls = normalizeBrandLandingUrls(rows)
            } catch (e) {
              console.error('[publish] brand_landing_pages fetch failed (non-fatal):', e?.message)
              landingUrls = []
            }
          }

          if (brand) {
            // Merge the updated fields into the review object for sync,
            // then do the full Supabase→Replit shape transform.
            const syncReview = shapeReviewForSync(
              { ...review, ...updates },
              brand,
              { landingUrls },
            )

            const syncRes = await fetch(`${replitUrl}/api/sync/review`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${syncSecret}`,
              },
              body: JSON.stringify({
                review: syncReview,
                brand,
                expected_full_article_length: syncReview.full_article_length ?? null,
                expected_full_article_hash: syncReview.full_article_hash ?? null,
              }),
              signal: AbortSignal.timeout(30000),
            })

            if (syncRes.ok) {
              const syncResult = await syncRes.json()
              const expectedLen = Number(syncReview.full_article_length ?? 0)
              const receivedLen = Number(syncResult?.full_article_length ?? -1)
              const lengthMatches = receivedLen === expectedLen
              const expectedHash = String(syncReview.full_article_hash ?? '')
              const receivedHash = String(syncResult?.full_article_hash ?? '')
              const hashMatches = expectedHash.length > 0 && expectedHash === receivedHash
              syncStatus = {
                success: hashMatches,
                review_id: syncResult.review_id,
                expected_full_article_length: expectedLen,
                received_full_article_length: receivedLen,
                full_article_length_matches: lengthMatches,
                expected_full_article_hash: expectedHash,
                received_full_article_hash: receivedHash,
                full_article_hash_matches: hashMatches,
                ...(hashMatches ? {} : { error: 'full_article hash mismatch on live sync' }),
              }
              console.log(`[publish] Synced to live site: ${reviewSlug}`)
            } else {
              const text = await syncRes.text().catch(() => '')
              syncStatus = { success: false, error: `${syncRes.status}: ${text}` }
              console.error(`[publish] Live sync failed: ${syncRes.status} ${text}`)
            }
          } else {
            syncStatus = { success: false, error: 'No brand data found' }
          }
        } catch (syncErr) {
          syncStatus = { success: false, error: syncErr.message }
          console.error('[publish] Live sync error:', syncErr.message)
        }
      }
    }

    return Response.json({
      success: true,
      id,
      action,
      status: updates.status,
      published_at: updates.published_at,
      live_sync: syncStatus,
      ...(action === 'publish' && updates.fact_check_status === 'ai_generated_with_warnings'
        ? { warnings: 'Review published with non-blocking warnings (plural agreement, coherence heuristics). See server logs.' }
        : {}),
    })
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
