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
 *
 * ─── PR1: Score-Verdict Coherence Guard (2026-04-21) ───
 * Added server-side enforcement so a review's visible verdict, summary,
 * and title can NEVER contradict its stored threat_score. The Affitto
 * Casa page shipped with:
 *   - <title>: "Threat Score 0/100" (score synced as 0)
 *   - body:   "Threat Score 3/100" (correct stored score)
 *   - verdict: "Confirmed Rental Scam — Avoid All Contact" (score 3 is
 *              tier 'low', frameAsScam=false — this phrasing is
 *              defamation-risk and Google-spam-classifier bait)
 *
 * Root cause was two-fold:
 *   1. `threat_score: review.scam_score ?? 0` defaulted to 0 when the
 *      writer pipeline hadn't stamped the brand's recalibrated score
 *      onto the review row yet, so Replit's prerender title template
 *      rendered 0/100.
 *   2. The LLM writer prompt's tier-aware hedging worked in aggregate
 *      but drifted on strong-evidence-low-score brands — the body read
 *      as investigative but the `verdict` / `summary` fields leaked
 *      declarative scam language. We now refuse to sync a review where
 *      the prose doesn't match the tier, and normalize it in-place
 *      rather than bailing.
 *
 * Enforcement policy:
 *   - REFUSE to sync any review whose threat_score is null/undefined
 *     after fallback to brand.scam_score (throws, surfaced in admin UI)
 *   - REWRITE verdict/summary/title to tier-appropriate phrasing when
 *     the source text contains forbidden declarative scam phrases for
 *     that tier. Original text preserved in _original_* fields for
 *     audit trail on the Supabase row (admin can see drift events).
 *   - EXPORT threat_tier / threat_label / threat_badge so Replit's
 *     prerender renders the correct severity chip instead of hardcoding
 *     "CONFIRMED SCAM" regardless of score.
 */

import { classifyThreat, dedupeCelebrityList } from '@/lib/threat-score'

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

// Declarative scam phrases that are NEVER allowed in the verdict / summary
// / title / meta of a non-confirmed (score < 60, frameAsScam=false) review.
// Match is case-insensitive. Matching a single phrase triggers rewrite;
// the raw text is preserved in _original_verdict/_original_summary on the
// synced row so admin can diff what the writer drifted into.
//
// Keep this list tight. Catch declarative scam verdicts ("Confirmed Rental Scam",
// "Confirmed Crypto Scam", "is a scam", "is a fraudulent platform") and leave
// hedged investigative phrasing alone: "is a suspected scam", "appears to be a scam",
// "shows red flags consistent with scam patterns", "exhibits scam indicators".
// Hedging words like "suspected" / "alleged" / "apparent" between "is a" and
// "scam" deliberately do NOT trip the regex — that is the Reuters/FT investigative
// voice we want on non-confirmed tiers. Only unhedged "is a [X] scam" is banned.
const FORBIDDEN_DECLARATIVE_PHRASES = [
  /\bconfirmed\s+(?:crypto|rental|investment|financial|fraud|fraudulent)?\s*scam\b/i,
  /\bis\s+a\s+(?:confirmed\s+)?(?:crypto|rental|investment)?\s*scam\b/i,
  /\bis\s+(?:a\s+)?fraudulent\s+(?:platform|operation|scheme|broker|site|service)\b/i,
  /\bavoid\s+all\s+contact\b/i,
  /\bdo\s+not\s+deposit\b/i,
]

/**
 * Return the first forbidden phrase that matches `text`, or null.
 * Used to decide whether prose needs rewriting AND to log which phrase
 * tripped the guard for admin visibility.
 */
function findDeclarativeDrift(text) {
  if (!text || typeof text !== 'string') return null
  for (const pattern of FORBIDDEN_DECLARATIVE_PHRASES) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}

/**
 * Rewrite verdict / summary / meta prose to tier-appropriate phrasing
 * when the LLM-generated text contains forbidden declarative scam
 * language for a tier that requires hedging.
 *
 * `role` controls the shape of the replacement:
 *   - 'verdict' → one-sentence badge-style verdict
 *   - 'summary' → 2-3 sentence card preview (keeps stats if present)
 *   - 'title'   → SEO title (under 60 chars)
 *   - 'meta'    → meta description (under 155 chars)
 */
function rewriteForTier(brandName, role, threat) {
  const safeName = brandName || 'This platform'
  switch (role) {
    case 'verdict':
      // threat.verdictOpener already has tier-appropriate hedging baked
      // in (see lib/threat-score.js TIERS array).
      return `${safeName} ${threat.verdictOpener}.`
    case 'summary':
      return `${safeName} ${threat.prose}, scoring ${threat.score}/100 on Crypto Killer's threat index. Evidence-based investigation ongoing.`
    case 'title':
      return `${safeName} Review — ${threat.score}/100 Threat Score | Crypto Killer`
    case 'meta':
      return `${safeName} ${threat.prose}, scoring ${threat.score}/100. Crypto Killer investigation findings and red flags.`
    default:
      return `${safeName} ${threat.verdictOpener}.`
  }
}

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
 *
 * THROWS if neither the review row nor the brand row carries a numeric
 * scam_score. A null-score review must not be synced — the title tag
 * on Replit's prerender would render "Threat Score 0/100" and the
 * prose would render the correct stored value, creating the exact
 * contradiction that shipped in the Affitto Casa review.
 */
export function shapeReviewForSync(review, brand) {
  if (!review) return review

  // ── Score resolution + hard guard ──
  // scam_score lives on the brand row canonically. The review row has a
  // frozen copy stamped at content-generation time. Prefer the frozen
  // value (so historical reviews stay consistent if the brand gets
  // re-scored) but fall back to the live brand score if the review row
  // never got its copy. Refuse to sync a review with no score at all.
  const frozenScore = Number.isFinite(review.scam_score) ? review.scam_score : null
  const liveScore = Number.isFinite(brand?.scam_score) ? brand.scam_score : null
  const resolvedScore = frozenScore ?? liveScore

  if (resolvedScore === null) {
    throw new Error(
      `[sync-shape] refusing to sync review "${review.slug}" with no threat_score ` +
        `(review.scam_score=${review.scam_score}, brand.scam_score=${brand?.scam_score}). ` +
        `Stamp the score during content generation before publishing.`
    )
  }

  const threat = classifyThreat(resolvedScore)

  const readingMinutes = review.word_count
    ? Math.max(1, Math.round(review.word_count / 200))
    : 0

  // Strip placeholders out of methodology/disclaimer — they were left
  // inline by the writer for the polish pipeline to resolve into real
  // images, but polish doesn't always fill every slot and we don't want
  // "[CHART NEEDED: ...]" text leaking into the live page.
  const methodologyText = stripPlaceholders(review.methodology)
  const disclaimerText = stripPlaceholders(review.disclaimer)

  // ── Coherence guard on verdict / summary / title / meta ──
  // For tiers where frameAsScam=false we refuse to ship declarative
  // scam language even if the LLM produced it. Log the drift so admin
  // can see it; normalize the prose to tier-appropriate phrasing.
  const drift = {}
  let verdictText = review.verdict ?? ''
  let summaryText = review.summary ?? ''
  let titleText = review.title ?? ''
  let metaText = review.meta_description ?? ''

  if (!threat.frameAsScam) {
    const vDrift = findDeclarativeDrift(verdictText)
    if (vDrift) {
      drift.verdict = { original: verdictText, matched: vDrift }
      verdictText = rewriteForTier(brand?.name, 'verdict', threat)
    }
    const sDrift = findDeclarativeDrift(summaryText)
    if (sDrift) {
      drift.summary = { original: summaryText, matched: sDrift }
      summaryText = rewriteForTier(brand?.name, 'summary', threat)
    }
    const tDrift = findDeclarativeDrift(titleText)
    if (tDrift) {
      drift.title = { original: titleText, matched: tDrift }
      titleText = rewriteForTier(brand?.name, 'title', threat)
    }
    const mDrift = findDeclarativeDrift(metaText)
    if (mDrift) {
      drift.meta = { original: metaText, matched: mDrift }
      metaText = rewriteForTier(brand?.name, 'meta', threat)
    }
  }

  // Hero description = first sentence of (normalized) summary.
  // Warning callout — for non-confirmed tiers, don't assert "this is a
  // scam" above the fold. Use hedged language proportionate to tier.
  const heroDescription = (() => {
    if (!summaryText) return ''
    const first = summaryText.split(/[.!?]\s+/)[0].trim()
    return /[.!?]$/.test(first) ? first : `${first}.`
  })()
  const warningCallout = threat.frameAsScam
    ? `Do not send money or identity documents to ${brand?.name || 'this platform'}.`
    : `Verify ${brand?.name || 'this platform'}'s regulatory status before sending money or identity documents.`

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

  // ── Rich-content passthrough (migration 0002 on Replit, 2026-04-21) ──
  // Supabase stores everything the Imagen/audit polish pipeline produces:
  // hero image URL, inline images, chart/diagram metadata, sources list,
  // protection-steps section, "not for you" qualifier, and the YMYL
  // expertise-depth block. Replit now has columns for all of these, so we
  // stop dropping them here. Arrays are normalised to [] and text fields
  // to '' so Replit's INSERT never encounters undefined.
  const contentImages = Array.isArray(review.content_images)
    ? review.content_images.filter((c) => c && c.url)
    : []
  const visualMeta = Array.isArray(review.visual_meta)
    ? review.visual_meta.filter((v) => v && v.type)
    : []
  const sources = Array.isArray(review.sources)
    ? review.sources.filter((s) => s && s.url)
    : []
  // Strip placeholder markers from long-form text fields — same treatment
  // methodology_text gets above. These were meant to be resolved by the
  // polish pipeline into real visuals but sometimes slip through.
  const protectionSteps = stripPlaceholders(review.protection_steps)
  const notForYou = stripPlaceholders(review.not_for_you)
  const expertiseDepth = stripPlaceholders(review.expertise_depth)

  return {
    // Scalar columns on the reviews row — note the field renames:
    //   scam_score → threat_score
    //   methodology → methodology_text
    //   disclaimer → disclaimer_text
    //   review_date → investigation_date
    //   author_name → author
    slug: review.slug,
    status: review.status ?? 'published',
    threat_score: resolvedScore,

    // ── NEW: tier metadata (PR1) ──
    // Replit's prerender should render the tier chip / label / badge
    // from these fields rather than hardcoding "CONFIRMED SCAM" for
    // every review. Replit adds a read-side migration; until that ships
    // these fields are no-ops downstream but cost nothing to send.
    threat_tier: threat.tier,
    threat_label: threat.label,
    threat_badge: threat.badge,
    frame_as_scam: threat.frameAsScam,

    title: titleText,
    verdict: verdictText,
    summary: summaryText,
    meta_description: metaText,
    hero_description: heroDescription,
    warning_callout: warningCallout,
    investigation_date: review.review_date || review.published_at || new Date().toISOString(),
    methodology_text: methodologyText,
    disclaimer_text: disclaimerText,
    word_count: review.word_count ?? 0,
    reading_minutes: readingMinutes,
    author: review.author_name ?? 'Crypto Killer Research Team',

    // Audit trail — if we rewrote any prose because of tier drift, the
    // original text is preserved here so admin can see what the writer
    // drifted into. Replit should NOT render these; they are for the
    // sync log / admin review queue only.
    _coherence_drift: Object.keys(drift).length > 0 ? drift : null,

    // Rich-content columns (migration 0002 on Replit). These back the hero
    // image, inline images, chart/diagram visuals, sources list, protection
    // steps, "when this review may not apply" qualifier, and expertise-depth
    // block on the live page. Before 2026-04-21 these were all silently
    // dropped because Replit had no columns for them.
    hero_image_url: review.hero_image_url || null,
    hero_image_alt: review.hero_image_alt || null,
    content_images: contentImages,
    visual_meta: visualMeta,
    protection_steps: protectionSteps,
    sources,
    not_for_you: notForYou,
    expertise_depth: expertiseDepth,

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

// Exported for tests and admin tooling that wants to detect drift
// without actually shipping a sync.
export { findDeclarativeDrift, FORBIDDEN_DECLARATIVE_PHRASES, rewriteForTier }
