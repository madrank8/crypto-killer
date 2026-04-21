/**
 * lib/sync-shape.js
 *
 * Single source of truth for transforming a Supabase review + brand row
 * into the shape Replit's /api/sync/review webhook expects.
 *
 * Supabase stores a review as one fat row with jsonb arrays for red_flags,
 * faq, sources, key_takeaways and a newline-delimited text blob for
 * how_it_works. Replit expects a decomposed shape: scalar columns on the
 * reviews row, a separate review_stats row, and separate tables for
 * red_flags, faq_items, funnel_stages, key_findings, and geo_targets.
 * Field names also differ (scam_score vs threat_score, methodology vs
 * methodology_text, faq vs faq_items, key_takeaways vs key_findings,
 * review_date vs investigation_date, disclaimer vs disclaimer_text).
 *
 * Without this transform, Replit's sync webhook silently no-ops most
 * fields — the live page shows "0/100" (threat_score defaults to 0),
 * no FAQ, no key findings, no funnel stages, no methodology, no
 * disclaimer, and no sidebar stats.
 *
 * Previously this logic lived inline in both
 *   /app/api/admin/reviews/[id]/sync/route.js
 *   /app/api/admin/reviews/[id]/publish/route.js
 * as a slim red_flags/faq reshape only. Extracted here 2026-04-21 after
 * confirming the Affitto Casa review was rendering as a stripped-down
 * shell on cryptokiller.org because most fields were being dropped on
 * the way through the sync.
 */

import { dedupeCelebrityList } from '@/lib/threat-score'

// Canonical stage titles from the content-writer prompt. The prompt
// requires EXACTLY 4 paragraphs in this order. We use these as fallback
// titles when the model's prose doesn't prefix with "STAGE N: Title"
// cleanly.
const FUNNEL_STAGE_TITLES = [
  'Celebrity Impersonation & Ads',
  'The Funnel & Deposit',
  'Fake Profits & Manipulation',
  'The Withdrawal Trap',
]

// Drop content-image/chart/diagram placeholder markers the polish pipeline
// may or may not have resolved. A resolved image lives in visual_meta,
// content_images, or hero_image_url — not inline in prose.
function stripPlaceholders(text) {
  if (!text) return ''
  return text
    .replace(/\[IMAGE[^\]]*\]/gi, '')
    .replace(/\[CHART[^\]]*\]/gi, '')
    .replace(/\[DIAGRAM[^\]]*\]/gi, '')
    .replace(/\[INFOGRAPHIC[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Parse the how_it_works text blob (EXACTLY 4 paragraphs per prompt) into
// structured funnel_stages[] that Replit's funnel_stages table expects.
// If >4 paragraphs (placeholder sneaked through), keep only the ones
// that look like real stages. If <4, pad rather than crash.
function parseFunnelStages(howItWorks, brandData) {
  if (!howItWorks || typeof howItWorks !== 'string') return []

  const cleaned = stripPlaceholders(howItWorks)
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p.length > 40)

  const stages = []
  for (let i = 0; i < 4; i++) {
    const raw = paragraphs[i] || ''
    // Match "STAGE N: Title. Description..." or "N. Title. Description..."
    const stageMatch = raw.match(/^(?:STAGE\s+\d+:\s*|Stage\s+\d+:\s*|\d+\.\s*)([^.]+?)\.\s+(.+)$/s)
    let title
    let description
    if (stageMatch) {
      title = stageMatch[1].trim()
      description = stageMatch[2].trim()
    } else {
      title = FUNNEL_STAGE_TITLES[i]
      description = raw
    }

    // Per-stage stat cards — keyed to brand-level data so the live site's
    // Stage 1/2/3/4 cards render real numbers instead of empty slots.
    let statValue = ''
    let statLabel = ''
    if (i === 0) {
      statValue = `${(brandData?.total_creatives || 0).toLocaleString()} ads`
      statLabel = brandData?.total_celebrities
        ? `impersonating ${brandData.total_celebrities} celebrities`
        : ''
    } else if (i === 1) {
      statValue = 'Instant'
      statLabel = 'deposit confirmation'
    } else if (i === 2) {
      statValue = brandData?.lifespan_days ? `${brandData.lifespan_days} days` : ''
      statLabel = 'of active manipulation'
    } else {
      statValue = `${brandData?.total_geos || 0} countries`
      statLabel = 'affected victim pool'
    }

    stages.push({
      stage_number: i + 1,
      title,
      description,
      stat_value: statValue,
      stat_label: statLabel,
      bullets: [],
      order_index: i,
    })
  }
  return stages
}

// Group brand.geo_list into rough regions so the sidebar "Geographic
// Targeting" card has something to show. Coarse on purpose.
const GEO_REGION_MAP = {
  Americas: ['US', 'CA', 'MX', 'BR', 'AR', 'CO', 'PE', 'CL'],
  Europe: ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'PT', 'IE', 'CH', 'AT', 'SE', 'NO', 'FI', 'DK', 'PL', 'CZ', 'HU', 'RO', 'GR', 'BG', 'HR', 'RS', 'SI', 'SK', 'UA'],
  'Asia Pacific': ['JP', 'KR', 'CN', 'IN', 'TH', 'VN', 'PH', 'ID', 'MY', 'SG', 'AU', 'NZ', 'PK', 'BD'],
  'Middle East & Africa': ['AE', 'SA', 'IL', 'TR', 'EG', 'ZA', 'NG', 'KE'],
}

function buildGeoTargets(geoList) {
  if (!Array.isArray(geoList) || geoList.length === 0) return []
  const byRegion = {}
  for (const code of geoList) {
    const cc = String(code).toUpperCase().trim()
    if (!cc) continue
    const region = Object.keys(GEO_REGION_MAP).find((r) => GEO_REGION_MAP[r].includes(cc)) || 'Other'
    if (!byRegion[region]) byRegion[region] = []
    byRegion[region].push(cc)
  }
  return Object.entries(byRegion).map(([region, codes], i) => ({
    region,
    country_codes: codes.join(', '),
    order_index: i,
  }))
}

/**
 * Transform a Supabase review row (+ associated brand row) into the
 * payload shape Replit's /api/sync/review endpoint expects.
 *
 * Call this immediately before POSTing to Replit. The returned object
 * should be wrapped as `{ review: <this>, brand }`.
 */
export function shapeReviewForSync(review, brand) {
  if (!review) return review

  const readingMinutes = review.word_count
    ? Math.max(1, Math.round(review.word_count / 200))
    : 0

  // Strip placeholders out of methodology/disclaimer — they were left
  // inline by the writer for the polish pipeline to resolve into real
  // images, but polish doesn't always fill every slot and we don't want
  // "[CHART NEEDED: ...]" text leaking into the live page.
  const methodologyText = stripPlaceholders(review.methodology)
  const disclaimerText = stripPlaceholders(review.disclaimer)

  // Hero description = first sentence of summary (short lede).
  // Warning callout = short red-alert line rendered above the fold.
  // Neither is a Supabase column, so we derive them.
  const heroDescription = (() => {
    if (!review.summary) return ''
    const first = review.summary.split(/[.!?]\s+/)[0].trim()
    // Avoid double-terminal-punctuation if the captured first sentence
    // already ends with a period (edge case when summary has no "[.!?]\s+"
    // pattern and returns the whole string as the first element).
    return /[.!?]$/.test(first) ? first : `${first}.`
  })()
  const warningCallout = `Do not send money or identity documents to ${brand?.name || 'this platform'}.`

  const red_flags = (review.red_flags || []).map((rf, i) => {
    const src = rf || {}
    return {
      emoji: src.emoji || '🚩',
      title: src.title || src.flag || '',
      description: src.description || src.detail || '',
      order_index: i,
    }
  })

  const faq_items = (review.faq || []).map((q, i) => {
    const src = q || {}
    return {
      question: src.question || src.q || src.title || '',
      answer: src.answer || src.a || src.body || '',
      order_index: i,
    }
  })

  // key_takeaways (Supabase jsonb array of strings) → key_findings
  // (Replit: array of { content }).
  const key_findings = (review.key_takeaways || []).map((k, i) => ({
    content: typeof k === 'string' ? k : (k?.content || k?.text || ''),
    order_index: i,
  }))

  const funnel_stages = parseFunnelStages(review.how_it_works, brand)
  const geo_targets = buildGeoTargets(brand?.geo_list)

  // review_stats — aggregates come from the brand row. Dedupe the
  // celebrity list so SpyOwl's occasional compound strings don't
  // become stray single entries containing commas.
  const stats = {
    ad_creatives: brand?.total_creatives || 0,
    countries_targeted: brand?.total_geos || 0,
    days_active: brand?.lifespan_days || 0,
    celebrities_abused: brand?.total_celebrities || 0,
    weekly_velocity: brand?.velocity_7d || 0,
    first_detected: brand?.first_seen_at
      ? new Date(brand.first_seen_at).toISOString().split('T')[0]
      : '',
    last_active: brand?.last_seen_at
      ? new Date(brand.last_seen_at).toISOString().split('T')[0]
      : '',
    celebrity_names: dedupeCelebrityList(brand?.celebrity_list).slice(0, 50),
  }

  return {
    // Scalar columns on the reviews row — note the field renames:
    //   scam_score → threat_score
    //   methodology → methodology_text
    //   disclaimer → disclaimer_text
    //   review_date → investigation_date
    //   author_name → author
    slug: review.slug,
    status: review.status ?? 'published',
    threat_score: review.scam_score ?? 0,
    verdict: review.verdict ?? '',
    summary: review.summary ?? '',
    hero_description: heroDescription,
    warning_callout: warningCallout,
    investigation_date: review.review_date || review.published_at || new Date().toISOString(),
    methodology_text: methodologyText,
    disclaimer_text: disclaimerText,
    meta_description: review.meta_description ?? '',
    word_count: review.word_count ?? 0,
    reading_minutes: readingMinutes,
    author: review.author_name ?? 'Crypto Killer Research Team',

    // Child tables — Replit's webhook deletes and re-inserts these on
    // every sync call so this is authoritative.
    stats,
    red_flags,
    faq_items,
    funnel_stages,
    key_findings,
    geo_targets,

    // Legacy flat aliases in case anything downstream still reads them.
    faq: faq_items,
    key_takeaways: review.key_takeaways || [],
  }
}
