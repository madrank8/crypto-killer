/**
 * Shared Replit live-site delivery for reviews + blog content.
 *
 * Rebuilds payloads from current Supabase rows (fresh), then POSTs to
 * REPLIT_SITE_URL. Used by publish routes (best-effort), manual /sync
 * routes, and the publish_outbox cron worker.
 */

import { supaFetch } from '@/lib/supabase'
import { shapeContentForSync } from '@/lib/content-sync-shape'
import { shapeReviewForSync, normalizeBrandLandingUrls } from '@/lib/sync-shape'
import { computePlatformAggregates } from '@/lib/platform-aggregates'

function syncEnvState() {
  const replitUrl = process.env.REPLIT_SITE_URL
  const syncSecret = process.env.SYNC_SECRET
  return {
    replitUrl,
    syncSecret,
    env: {
      REPLIT_SITE_URL: replitUrl ? 'set' : 'unset',
      SYNC_SECRET: syncSecret ? 'set' : 'unset',
      REPLIT_SITE_URL_host: replitUrl ? (() => {
        try { return new URL(replitUrl).host } catch { return null }
      })() : null,
      SYNC_SECRET_length: syncSecret ? syncSecret.length : 0,
    },
  }
}

/**
 * Deliver a content (blog) row to the live site.
 * @param {string} contentId
 * @param {'publish'|'unpublish'} action
 */
export async function deliverContentToLive(contentId, action = 'publish') {
  const { replitUrl, syncSecret, env } = syncEnvState()
  if (!replitUrl || !syncSecret) {
    return {
      success: false,
      error: 'REPLIT_SITE_URL and SYNC_SECRET are not configured',
      env,
    }
  }

  const contentRows = await supaFetch(`/content?id=eq.${contentId}&select=*&limit=1`, {
    useServiceRole: true,
  })
  const content = Array.isArray(contentRows) ? contentRows[0] : null
  if (!content) {
    return { success: false, error: 'Content not found', env }
  }

  let topic = null
  if (content.topic_id) {
    const topicRows = await supaFetch(`/topics?id=eq.${content.topic_id}&select=*&limit=1`, {
      useServiceRole: true,
    })
    topic = Array.isArray(topicRows) ? topicRows[0] : null
  }

  const shaped = shapeContentForSync(
    action === 'unpublish' ? { ...content, _action: 'unpublish' } : content,
  )
  const payload = {
    content: shaped,
    topic,
    destination: 'blog',
    url: `/blog/${content.slug}`,
    ...(action === 'unpublish' ? { action: 'unpublish' } : {}),
  }

  const endpoints = ['/api/sync/blog', '/api/sync/content', '/api/sync/post']
  const attempts = []
  let lastErr = null

  for (const endpoint of endpoints) {
    const startedAt = Date.now()
    try {
      const res = await fetch(`${replitUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncSecret}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      })
      const durationMs = Date.now() - startedAt
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        attempts.push({ endpoint, status: res.status, durationMs, ok: true })
        return {
          success: true,
          endpoint,
          result: data,
          attempts,
          env,
          slug: content.slug,
        }
      }
      const text = await res.text().catch(() => '')
      const truncated = text.length > 200 ? `${text.slice(0, 200)}…` : text
      lastErr = `${endpoint} -> ${res.status} ${truncated}`
      attempts.push({ endpoint, status: res.status, durationMs, ok: false, body: truncated })
    } catch (e) {
      const durationMs = Date.now() - startedAt
      lastErr = `${endpoint} -> ${e.message}`
      attempts.push({ endpoint, status: null, durationMs, ok: false, error: e.message })
    }
  }

  return {
    success: false,
    error: lastErr || 'Unknown sync failure',
    attempts,
    env,
    slug: content.slug,
  }
}

/**
 * Evaluate Replit review sync response integrity (hash/length).
 * Pure helper — exported for tests.
 */
export function evaluateReviewSyncIntegrity(syncReview, syncResult) {
  const expectedLen = Number(syncReview.full_article_length ?? 0)
  const receivedLen = Number(syncResult?.full_article_length ?? -1)
  const lengthMatches = receivedLen === expectedLen
  const lengthOk = receivedLen < 0 || lengthMatches
  const expectedHash = String(syncReview.full_article_hash ?? '')
  const storedHash = String(syncResult?.full_article_hash ?? '')
  const incomingHash = String(syncResult?.incoming_full_article_hash ?? '')
  const liveSyncOk = syncResult?.ok === true
  const hashConfirmedByLive = syncResult?.full_article_hash_matches === true
  const explicitIntegrityFail = syncResult?.full_article_hash_matches === false
  const rescueIntegrity =
    expectedHash.length === 64 &&
    incomingHash === expectedHash &&
    lengthOk
  const integrityOk = hashConfirmedByLive || rescueIntegrity
  const hashMatches = liveSyncOk && integrityOk

  return {
    success: hashMatches,
    review_id: syncResult?.review_id,
    expected_full_article_length: expectedLen,
    received_full_article_length: receivedLen,
    full_article_length_matches: lengthMatches,
    expected_full_article_hash: expectedHash,
    received_full_article_hash: storedHash,
    received_incoming_full_article_hash: incomingHash,
    full_article_hash_matches: hashMatches,
    ...(hashMatches
      ? {}
      : {
          error: !liveSyncOk
            ? 'live site sync response missing ok: true'
            : explicitIntegrityFail
              ? 'full_article hash mismatch on live sync'
              : 'live site did not confirm full_article integrity',
        }),
  }
}

/**
 * Deliver a review row to the live site.
 * Rebuilds brand + translations + recent ads + platform aggregates.
 */
export async function deliverReviewToLive(reviewId, action = 'publish') {
  const { replitUrl, syncSecret, env } = syncEnvState()
  if (!replitUrl || !syncSecret) {
    return {
      success: false,
      error: 'REPLIT_SITE_URL and SYNC_SECRET are not configured',
      env,
      skipped: true,
    }
  }

  const reviews = await supaFetch(`/reviews?id=eq.${reviewId}&select=*&limit=1`, {
    useServiceRole: true,
  })
  const review = Array.isArray(reviews) ? reviews[0] : null
  if (!review) {
    return { success: false, error: 'Review not found', env }
  }

  let brand = null
  if (review.brand_id) {
    const brands = await supaFetch(`/scam_brands?id=eq.${review.brand_id}&select=*&limit=1`, {
      useServiceRole: true,
    })
    brand = Array.isArray(brands) ? brands[0] : null
  }
  if (!brand) {
    return { success: false, error: 'No brand data found', env }
  }

  let landingUrls = []
  try {
    const rows = await supaFetch(
      `/brand_landing_pages?brand_id=eq.${brand.id}` +
        `&select=archive_url,archive_status,live_url,captured_at` +
        `&order=captured_at.desc&limit=20`,
      { useServiceRole: true },
    )
    landingUrls = normalizeBrandLandingUrls(rows)
  } catch (e) {
    console.warn('[live-sync] brand_landing_pages fetch failed (non-fatal):', e?.message)
  }

  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [translations, recentAds, platformStats] = await Promise.all([
    supaFetch(
      `/review_translations?review_id=eq.${review.id}&status=eq.published&select=*&order=locale.asc`,
      { useServiceRole: true },
    )
      .then((rows) => (Array.isArray(rows) ? rows : []))
      .catch((e) => {
        console.warn('[live-sync] translations fetch failed (non-fatal):', e?.message)
        return []
      }),

    brand?.normalized_name
      ? supaFetch(
          `/creatives?normalized_offer=eq.${encodeURIComponent(brand.normalized_name)}` +
            `&first_seen_at=gte.${encodeURIComponent(sinceIso)}` +
            `&select=id,offer_name,celebrity_name,geo,land_language,is_video,created_at,first_seen_at,creative_text(main_text,link_text,link_url,post_url,fp_link)` +
            `&order=first_seen_at.desc&limit=20`,
          { useServiceRole: true },
        )
          .then((rows) =>
            (Array.isArray(rows) ? rows : []).map((r) => {
              const t = Array.isArray(r.creative_text) ? r.creative_text[0] : r.creative_text || {}
              return {
                creative_id: r.id,
                offer_name: r.offer_name,
                celebrity_name: r.celebrity_name,
                geo: r.geo,
                land_language: r.land_language,
                is_video: r.is_video,
                spyowl_created_at: r.created_at,
                first_seen_at: r.first_seen_at,
                main_text: t?.main_text,
                link_text: t?.link_text,
                link_url: t?.link_url,
                post_url: t?.post_url,
                fp_link: t?.fp_link,
              }
            }),
          )
          .catch((e) => {
            console.warn('[live-sync] recent ads fetch failed (non-fatal):', e?.message)
            return []
          })
      : Promise.resolve([]),

    computePlatformAggregates().catch((e) => {
      console.warn('[live-sync] platform aggregates fetch failed (non-fatal):', e?.message)
      return null
    }),
  ])

  // Unpublish: shape still ships the row; Replit webhook interprets status.
  const syncReview = shapeReviewForSync(review, brand, {
    landingUrls,
    translations,
    recentAds,
    platformStats,
  })

  const syncRes = await fetch(`${replitUrl}/api/sync/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${syncSecret}`,
    },
    body: JSON.stringify({
      review: syncReview,
      brand,
      action,
      expected_full_article_length: syncReview.full_article_length ?? null,
      expected_full_article_hash: syncReview.full_article_hash ?? null,
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!syncRes.ok) {
    const text = await syncRes.text().catch(() => '')
    return {
      success: false,
      error: `${syncRes.status}: ${text}`,
      env,
      slug: review.slug,
    }
  }

  const syncResult = await syncRes.json().catch(() => ({}))
  const integrity = evaluateReviewSyncIntegrity(syncReview, syncResult)
  return { ...integrity, env, slug: review.slug, action }
}
