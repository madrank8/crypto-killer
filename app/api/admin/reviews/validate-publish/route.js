/**
 * app/api/admin/reviews/validate-publish/route.js
 *
 * Pre-publish schema + content validator.
 *
 * Runs as the last step before `reviews.status = 'published'`. Returns
 * 200 with `{ ok: true, failureCount: 0 }` when the review is publishable,
 * or 422 with `{ ok: false, failures: [...] }` when it isn't. Callers
 * (the publish route, the polish watchdog) should treat a 422 as a
 * `polish_failed` state.
 *
 * Every check is deterministic — no LLM calls — so this is cheap to
 * run on every publish attempt and safe to loop in from the cron
 * watchdog. The point is to catch the six bug classes the Floventra
 * audit surfaced BEFORE they ship:
 *
 *   1. PLACEHOLDER_LEAK           — [SCREENSHOT NEEDED: ...] in prose
 *   2. FUNNEL_STAGE_EMPTY         — stage content < 40 chars
 *   3. CELEB_COUNT_DRIFT          — item_list vs stats vs funnel disagree
 *   4. CITATION_SELF_CONTRADICTION — publisher flagged in red_flags
 *   5. CITATION_BLOCKED_URL       — grounding-API-redirect URL leaked
 *   6. UNSOURCED_NUMERIC_CLAIM    — "6 times more" with no citation
 *
 * Plus schema-enrichment sanity:
 *   7. DATASET_NO_DISTRIBUTION    — Dataset rich-result ineligible
 *   8. CLAIM_NO_APPEARANCE        — ClaimReview Fact Check ineligible (WARN only)
 *
 * Auth: uses the same CRON_SECRET / ADMIN_SECRET Bearer pattern as other
 * admin routes.
 *
 * Supabase access: uses the repo's existing `supabaseRequest` helper
 * (PostgREST thin wrapper from lib/supabase.js) — there is no Supabase
 * client SDK dependency in this project.
 */

import { NextResponse } from 'next/server'
import { supabaseRequest } from '@/lib/supabase'
import {
  normalizeDataset,
  normalizeClaims,
  normalizeBrandLandingUrls,
} from '@/lib/sync-shape'

const PLACEHOLDER_RX =
  /\[(SCREENSHOT|IMAGE|CHART|DIAGRAM|INFOGRAPHIC|PHOTO|STEP-BY-STEP)\s+NEEDED[^\]]*\]/i

// Any citation publisher name matching one of these patterns inside a
// red_flag title triggers the self-contradiction check. Keep this list
// tight — false positives block publishes.
const FABRICATED_REVIEW_PATTERNS = [/fabricat/i, /planted/i, /fake review/i]

const BLOCKED_URL_PATTERNS = [
  /grounding-api-redirect/i,
  /vertexaisearch\.cloud\.google\.com/i,
]

export async function POST(req) {
  // Auth: same two-way Bearer check as the watchdog — CRON_SECRET
  // primary, ADMIN_SECRET legacy fallback. Either works.
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const authorized =
    (process.env.CRON_SECRET && token === process.env.CRON_SECRET) ||
    (process.env.ADMIN_SECRET && token === process.env.ADMIN_SECRET)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 })
  }

  const { reviewId, strict = true } = body || {}
  if (!reviewId) {
    return NextResponse.json({ ok: false, error: 'reviewId required' }, { status: 400 })
  }

  // Basic UUID sanity so we don't build a malformed PostgREST filter.
  // Supabase REST still handles this defensively but a caller typo
  // producing "null" or "undefined" strings makes errors harder to read.
  if (!/^[0-9a-f-]{8,}$/i.test(reviewId)) {
    return NextResponse.json({ ok: false, error: 'reviewId malformed' }, { status: 400 })
  }

  let review
  try {
    const rows = await supabaseRequest(
      `/reviews?id=eq.${encodeURIComponent(reviewId)}&select=*&limit=1`
    )
    review = Array.isArray(rows) ? rows[0] : null
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'review fetch failed', detail: err?.message },
      { status: 500 }
    )
  }

  if (!review) {
    return NextResponse.json({ ok: false, error: 'review not found' }, { status: 404 })
  }

  const failures = []
  const warnings = []

  // ── 1. Placeholder leak check ────────────────────────────────
  const prose = collectProse(review)
  for (const { label, text } of prose) {
    const m = text.match(PLACEHOLDER_RX)
    if (m) {
      failures.push({
        code: 'PLACEHOLDER_LEAK',
        field: label,
        detail: m[0].slice(0, 120),
      })
    }
  }

  // ── 2. Funnel stage completeness ─────────────────────────────
  const stages = Array.isArray(review.funnel_stages) ? review.funnel_stages : []
  stages.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      failures.push({
        code: 'FUNNEL_STAGE_MALFORMED',
        field: `funnel_stages[${i}]`,
      })
      return
    }
    const content = typeof s.content === 'string' ? s.content : ''
    if (content.trim().length < 40) {
      failures.push({
        code: 'FUNNEL_STAGE_EMPTY',
        field: `funnel_stages[${i}].content`,
        detail: `stage "${s.title || i}" has ${content.length} chars (min 40)`,
      })
    }
    if (PLACEHOLDER_RX.test(content)) {
      failures.push({
        code: 'FUNNEL_STAGE_PLACEHOLDER',
        field: `funnel_stages[${i}].content`,
      })
    }
  })

  // ── 3. Count-drift check ─────────────────────────────────────
  // Celebrity count must be consistent across item_list, stats, and
  // any funnel_stage stat cards. The Floventra bug was item_list=24
  // but funnel_stages[0].stat = "26 celebrities".
  const celebFromItemList = countItemList(review.item_list)
  const celebFromStats = extractNumberNear(review.stats, ['celebrit', 'impersonat'])
  const celebFromStages = stages
    .map((s) => {
      const stat = typeof s?.stat === 'string' ? s.stat : ''
      const m = stat.match(/(\d+)\s*celebrit/i)
      return m ? Number(m[1]) : null
    })
    .filter((n) => n != null)

  const allCelebCounts = [celebFromItemList, celebFromStats, ...celebFromStages]
    .filter((n) => Number.isFinite(n) && n > 0)
  const uniqueCounts = [...new Set(allCelebCounts)]
  if (uniqueCounts.length > 1) {
    failures.push({
      code: 'CELEB_COUNT_DRIFT',
      field: 'item_list vs stats vs funnel_stages',
      detail: `found ${uniqueCounts.join(' vs ')}`,
    })
  }

  // ── 4. Citation self-contradiction + blocked URL ─────────────
  const redFlags = Array.isArray(review.red_flags) ? review.red_flags : []
  const flaggedPublishers = new Set()
  for (const rf of redFlags) {
    const combined = `${rf?.title || ''} ${rf?.description || ''}`
    if (FABRICATED_REVIEW_PATTERNS.some((p) => p.test(combined))) {
      const tokens = combined.match(/[A-Z][a-zA-Z]{4,}/g) || []
      tokens.forEach((t) => flaggedPublishers.add(t.toLowerCase()))
    }
  }
  const citations = Array.isArray(review.citations) ? review.citations : []
  for (const c of citations) {
    const pub = (c?.publisher || '').toLowerCase().trim()
    if (pub && flaggedPublishers.has(pub)) {
      failures.push({
        code: 'CITATION_SELF_CONTRADICTION',
        field: 'citations',
        detail: `publisher "${c.publisher}" is flagged in a red_flag as fabricated`,
      })
    }
    if (typeof c?.url === 'string' && BLOCKED_URL_PATTERNS.some((p) => p.test(c.url))) {
      failures.push({
        code: 'CITATION_BLOCKED_URL',
        field: 'citations',
        detail: `url "${c.url.slice(0, 80)}..." matches a blocked pattern`,
      })
    }
  }

  // ── 5. Numeric claim audit ───────────────────────────────────
  // Sentences like "6 times more persuasive" or "according to 2025 FTC
  // data" must resolve to a citation entry. Heuristic — we look for
  // overlap between the cited source name and the surrounding text.
  const proseBlob = prose.map((p) => p.text).join(' ')
  const suspectClaims = findUnsourcedStats(proseBlob)
  for (const claim of suspectClaims) {
    const hasSupport = citations.some((c) => {
      if (!c || typeof c.name !== 'string') return false
      const tokens = c.name.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
      return tokens.some((t) => claim.phrase.toLowerCase().includes(t))
    })
    if (!hasSupport) {
      // Treat as warning in non-strict mode (first 48h after deploy).
      const entry = {
        code: 'UNSOURCED_NUMERIC_CLAIM',
        field: 'prose',
        detail: claim.phrase.slice(0, 140),
      }
      if (strict) failures.push(entry)
      else warnings.push(entry)
    }
  }

  // ── 6. Schema enrichment sanity ──────────────────────────────
  // Load the brand row for observation-window dates (first_seen_at /
  // last_seen_at live on scam_brands, not on reviews). Include
  // landing_urls (migration 005) so normalizeClaims can fall back
  // through the full 3-tier priority when brand_landing_pages isn't
  // populated yet.
  let brand = null
  if (review.brand_id) {
    try {
      const rows = await supabaseRequest(
        `/scam_brands?id=eq.${encodeURIComponent(review.brand_id)}` +
          `&select=id,first_seen_at,last_seen_at,name,slug,celebrity_list,geo_list,total_celebrities,landing_urls` +
          `&limit=1`
      )
      brand = Array.isArray(rows) ? rows[0] : null
    } catch {
      // Non-fatal — Dataset validation degrades to warnings when
      // brand row can't be loaded. Better than failing the whole run.
      brand = null
    }
  }

  // Pull Wayback snapshot URLs for this brand so the CLAIM_NO_APPEARANCE
  // check reflects what would actually ship in the sync payload — not
  // just the writer's raw null-appearance output. Soft-fail: if the
  // fetch errors we fall through to brand.landing_urls (live URLs) so
  // validation still runs with best-available data.
  let landingUrlsForClaims = []
  if (brand?.id) {
    try {
      const archiveRows = await supabaseRequest(
        `/brand_landing_pages?brand_id=eq.${encodeURIComponent(brand.id)}` +
          `&select=archive_url,archive_status,live_url,captured_at` +
          `&order=captured_at.desc&limit=20`
      )
      landingUrlsForClaims = normalizeBrandLandingUrls(archiveRows)
    } catch {
      landingUrlsForClaims = []
    }
  }
  // Final fallback: brand.landing_urls from migration 005 (live URLs).
  // Only use when the archive fetch above returned nothing.
  if (landingUrlsForClaims.length === 0 && Array.isArray(brand?.landing_urls)) {
    landingUrlsForClaims = brand.landing_urls.filter(
      (u) => typeof u === 'string' && u.startsWith('http')
    )
  }

  const toIso = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v.slice(0, 10)
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return null
  }

  if (review.dataset) {
    const ds = normalizeDataset(review.dataset, {
      brandName: brand?.name,
      brandSlug: review.slug || brand?.slug,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://cryptokiller.org',
      observationWindow: {
        start: toIso(brand?.first_seen_at),
        end: toIso(brand?.last_seen_at),
      },
    })
    if (!ds) {
      failures.push({ code: 'DATASET_MALFORMED', field: 'dataset' })
    } else if (!Array.isArray(ds.distribution) || ds.distribution.length === 0) {
      const entry = { code: 'DATASET_NO_DISTRIBUTION', field: 'dataset.distribution' }
      if (strict) failures.push(entry)
      else warnings.push(entry)
    }
  }

  if (Array.isArray(review.claims) && review.claims.length > 0) {
    const normalized = normalizeClaims(review.claims, {
      brandName: brand?.name,
      // Path B: feed the same archive-first URL list that shapeReviewForSync
      // uses at publish time. The CLAIM_NO_APPEARANCE check now reflects
      // what will actually ship in the public schema.
      adCreativeUrls: landingUrlsForClaims,
    })
    normalized.forEach((c, i) => {
      if (!c.appearance) {
        const entry = {
          code: 'CLAIM_NO_APPEARANCE',
          field: `claims[${i}]`,
          detail: `"${c.claimReviewed.slice(0, 60)}..." has no appearance URL — ClaimReview will be dropped from schema. ${
            landingUrlsForClaims.length === 0
              ? 'No Wayback snapshots or landing URLs exist for this brand yet; trigger the archive-landing-pages cron or re-run rebuild_brands after migration 005.'
              : 'The writer emitted appearance:null explicitly and no fallback URL was selectable.'
          }`,
        }
        // Soft-warn for now (Path B B4 step). Once backfill lands across
        // all brands we flip this to a hard failure.
        warnings.push(entry)
      }
    })
  }

  return NextResponse.json({
    ok: failures.length === 0,
    failureCount: failures.length,
    warningCount: warnings.length,
    failures,
    warnings,
    strict,
    reviewId,
  })
}

// ─── helpers ─────────────────────────────────────────────────────

function collectProse(review) {
  const out = []
  const push = (label, val) => {
    if (typeof val === 'string' && val.trim()) out.push({ label, text: val })
  }
  push('title', review.title)
  push('headline', review.headline)
  push('meta_description', review.meta_description)
  push('summary', review.summary)
  push('verdict', review.verdict)
  push('methodology', review.methodology)
  push('not_for_you', review.not_for_you)
  push('protection_steps', review.protection_steps)
  const rf = Array.isArray(review.red_flags) ? review.red_flags : []
  rf.forEach((r, i) => {
    push(`red_flags[${i}].title`, r?.title)
    push(`red_flags[${i}].description`, r?.description)
  })
  const stages = Array.isArray(review.funnel_stages) ? review.funnel_stages : []
  stages.forEach((s, i) => {
    push(`funnel_stages[${i}].title`, s?.title)
    push(`funnel_stages[${i}].content`, s?.content)
  })
  return out
}

function countItemList(itemList) {
  if (!itemList) return null
  if (Array.isArray(itemList)) return itemList.length
  if (typeof itemList === 'object' && Array.isArray(itemList.items)) return itemList.items.length
  return null
}

function extractNumberNear(obj, keyFragments) {
  if (!obj || typeof obj !== 'object') return null
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase()
    if (keyFragments.some((f) => kl.includes(f.toLowerCase()))) {
      const n = typeof v === 'number' ? v : parseInt(v, 10)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function findUnsourcedStats(text) {
  const rx = /(\d+\s*(?:times|x|%)\s*(?:more|higher|greater|persuasive|effective)[^.]{0,80}|according to\s+\d{4}\s+\w[^.]{0,80})/gi
  const matches = []
  let m
  while ((m = rx.exec(text)) !== null) {
    matches.push({ phrase: m[0] })
  }
  return matches
}
