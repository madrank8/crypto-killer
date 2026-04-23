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
 *
 * ─── PR2: Schema Enrichment Passthrough (2026-04-21) ───
 * The Vercel admin's content-generate route (d4cc29e) persists 12 enrichment
 * columns from the writer's `schema_enrichment` object:
 *   author_persona_id, alternative_headline, about_slugs, mention_slugs,
 *   speakable_selectors, citations, dataset, item_list, how_to, quotes,
 *   claims, target_keyword
 * These fields power Replit's blogSchemaEnrichment.ts builders to emit
 * ClaimReview (Google Fact Check Explorer — highest ROI for scam content),
 * HowTo (AI-extractable protection steps), ItemList (listicle rich results),
 * Dataset (SpyOwl first-party data E-E-A-T), Quotation (authority quotes
 * for LLM citation), and Speakable (voice assistant).
 *
 * Until this PR, sync-shape wasn't reading any of them — Replit had the
 * builders merged (cryptokiller#2, 457f921) but no input data. The live
 * Affitto Casa JSON-LD shipped with zero ClaimReview / HowTo / ItemList /
 * Dataset / Quotation / Speakable nodes as a result.
 *
 * This PR passes all 12 through with shape normalizers per field:
 *   - Coerce null/undefined to [] or null as appropriate
 *   - Filter malformed entries (missing required keys) so Replit's Drizzle
 *     INSERTs don't choke on partial LLM output
 *   - Validate enum fields (author persona, citation type, rating label)
 *   - Never throw — enrichment failures degrade to empty, not block publish
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

// ─── PR2: schema-enrichment normalizers ───
// Each normalizer: accepts whatever the writer / DB column returned,
// returns the shape Replit's blogSchemaEnrichment.ts builders expect.
// Philosophy: silent tolerance in, strict shape out. A malformed item
// is dropped; a missing field defaults. We never throw here — the LLM
// writer will drift on schema shape occasionally and blocking publish
// on that is worse than publishing with a few fewer enrichment nodes.

// Canonical source of truth lives in the Replit (cryptokiller) repo at
// artifacts/crypto-review/src/lib/writerPersonas.ts. Keep this set in
// lock-step with the keys of WRITER_PERSONAS there; a value here that
// doesn't exist there causes Replit's schemaBuilder.personNode() to
// silently fall back to the generic Organization author, stripping the
// Person@type JSON-LD node the prompt was working to produce.
const VALID_PERSONAS = new Set(['webb', 'nair', 'ortiz', 'pepi', 'majithia'])

function normalizePersonaId(raw, fallback = 'webb') {
  if (typeof raw !== 'string') return fallback
  const normalized = raw.trim().toLowerCase()
  return VALID_PERSONAS.has(normalized) ? normalized : fallback
}

function normalizeSlugArray(raw, { max = 50 } = {}) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const slug = item
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
    if (out.length >= max) break
  }
  return out
}

function normalizeSpeakableSelectors(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return ['.key-takeaways', '.summary']
  }
  return raw
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 10)
}

const VALID_CITATION_TYPES = new Set([
  'NewsArticle',
  'ScholarlyArticle',
  'Report',
  'WebPage',
  'GovernmentService',
])

function normalizeCitations(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    if (typeof c.url !== 'string' || !c.url.startsWith('http')) continue
    out.push({
      name: typeof c.name === 'string' ? c.name : c.url,
      url: c.url,
      type: VALID_CITATION_TYPES.has(c.type) ? c.type : 'WebPage',
      publisher: typeof c.publisher === 'string' ? c.publisher : null,
      datePublished: typeof c.datePublished === 'string' ? c.datePublished : null,
    })
  }
  return out
}

function normalizeDataset(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.name !== 'string' || typeof raw.description !== 'string') return null
  return {
    name: raw.name,
    description: raw.description,
    url: typeof raw.url === 'string' ? raw.url : null,
    datePublished: typeof raw.datePublished === 'string' ? raw.datePublished : null,
    variableMeasured: Array.isArray(raw.variableMeasured)
      ? raw.variableMeasured.filter((v) => typeof v === 'string').slice(0, 20)
      : [],
  }
}

function normalizeItemList(raw) {
  // Accept bare array OR object-with-items (v1.2 writer emits the latter)
  if (!raw) return []
  let items
  if (Array.isArray(raw)) items = raw
  else if (typeof raw === 'object' && Array.isArray(raw.items)) items = raw.items
  else return []
  const out = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.name !== 'string') continue
    out.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      entitySlug: typeof item.entitySlug === 'string' ? item.entitySlug : null,
    })
  }
  return out
}

function normalizeHowTo(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.name !== 'string') return null
  const steps = Array.isArray(raw.step) ? raw.step : Array.isArray(raw.steps) ? raw.steps : []
  const cleanSteps = []
  for (const st of steps) {
    if (!st || typeof st !== 'object') continue
    if (typeof st.name !== 'string' || typeof st.text !== 'string') continue
    cleanSteps.push({ name: st.name, text: st.text })
  }
  if (cleanSteps.length === 0) return null
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    totalTime: typeof raw.totalTime === 'string' ? raw.totalTime : null,
    steps: cleanSteps,
  }
}

function normalizeQuotes(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    if (typeof q.text !== 'string') continue
    const speakerName = typeof q.speakerName === 'string' ? q.speakerName : typeof q.spokenBy === 'string' ? q.spokenBy : null
    if (!speakerName) continue
    const citationUrl = typeof q.citationUrl === 'string' ? q.citationUrl : typeof q.citation === 'string' ? q.citation : typeof q.sourceUrl === 'string' ? q.sourceUrl : null
    const publishedDate = typeof q.publishedDate === 'string' ? q.publishedDate : typeof q.date === 'string' ? q.date : null
    out.push({
      text: q.text,
      speakerName,
      speakerSlug: typeof q.speakerSlug === 'string' ? q.speakerSlug : null,
      citationUrl,
      publishedDate,
    })
  }
  return out
}

const VALID_RATING_LABELS = new Set([
  'False',
  'Mostly False',
  'Misleading',
  'Partly True',
  'Mostly True',
  'True',
])

function normalizeClaims(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    if (typeof c.claimReviewed !== 'string') continue
    const ratingValue = Number.isFinite(c.ratingValue)
      ? Math.max(1, Math.min(5, Math.round(c.ratingValue)))
      : 1
    const ratingLabel = VALID_RATING_LABELS.has(c.ratingLabel) ? c.ratingLabel : 'False'
    out.push({
      claimReviewed: c.claimReviewed,
      ratingValue,
      ratingLabel,
      originator: typeof c.originator === 'string' ? c.originator : 'Unknown scam operators',
    })
  }
  return out
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
  //
  // 2026-04-22: celebrities_abused is now DERIVED from the deduped
  // list rather than trusting brand.total_celebrities. The upstream
  // aggregator doesn't collapse accent/transliteration variants
  // (see dedupeCelebrityList v2 in threat-score.js); if we trust its
  // count we end up asserting "26 celebrities" next to a list of 28.
  const dedupedCelebrityNames = dedupeCelebrityList(brand?.celebrity_list)
  const derivedCelebCount = dedupedCelebrityNames.length
  const aggregatorCelebCount = Number.isFinite(brand?.total_celebrities)
    ? brand.total_celebrities
    : 0

  // Non-blocking observability. When the aggregator is off by more than
  // 1 we want to fix it upstream eventually, but never block a publish.
  if (
    aggregatorCelebCount > 0 &&
    Math.abs(aggregatorCelebCount - derivedCelebCount) >= 2
  ) {
    console.warn(
      `[sync-shape] celeb-count drift for brand=${brand?.slug || brand?.name}: ` +
        `aggregator=${aggregatorCelebCount} deduped=${derivedCelebCount}. ` +
        `Using deduped count as authoritative.`,
    )
  }

  const stats = {
    ad_creatives: brand?.total_creatives || 0,
    countries_targeted: brand?.total_geos || 0,
    days_active: brand?.lifespan_days || 0,
    celebrities_abused: derivedCelebCount, // ← was brand?.total_celebrities
    weekly_velocity: brand?.velocity_7d || 0,
    first_detected: brand?.first_seen_at
      ? new Date(brand.first_seen_at).toISOString().split('T')[0]
      : '',
    last_active: brand?.last_seen_at
      ? new Date(brand.last_seen_at).toISOString().split('T')[0]
      : '',
    celebrity_names: dedupedCelebrityNames.slice(0, 50),
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

  // ── PR2: Schema enrichment passthrough ──
  // 12 fields from the writer's schema_enrichment object, now flattened
  // onto the review row by app/api/admin/content/generate/route.js.
  // Normalize each to the shape Replit's blogSchemaEnrichment.ts expects.
  // A missing / malformed field degrades to empty or null — we never
  // block publish on enrichment failures (those PRs are additive).
  const personaFallback = threat.frameAsScam ? 'webb' : 'ortiz'
  const authorPersonaId = normalizePersonaId(review.author_persona_id, personaFallback)
  const aboutSlugs = normalizeSlugArray(review.about_slugs, { max: 5 })
  const mentionSlugs = normalizeSlugArray(review.mention_slugs, { max: 50 })
  const speakableSelectors = normalizeSpeakableSelectors(review.speakable_selectors)
  const typedCitations = normalizeCitations(review.citations)
  const dataset = normalizeDataset(review.dataset)
  const itemList = normalizeItemList(review.item_list)
  const howTo = normalizeHowTo(review.how_to)
  const quotes = normalizeQuotes(review.quotes)
  const claims = normalizeClaims(review.claims)
  const alternativeHeadline =
    typeof review.alternative_headline === 'string' && review.alternative_headline.trim()
      ? review.alternative_headline.trim().slice(0, 110)
      : null
  const targetKeyword =
    typeof review.target_keyword === 'string' && review.target_keyword.trim()
      ? review.target_keyword.trim().toLowerCase()
      : brand?.name
      ? `${brand.name.toLowerCase()} scam`
      : null

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

    // ── Schema enrichment (PR2) ──
    // 12 fields powering Replit's blogSchemaEnrichment.ts builders:
    // ClaimReview (claims), HowTo (how_to), ItemList (item_list),
    // Dataset (dataset), Quotation (quotes), Speakable
    // (speakable_selectors), entity graph (about_slugs, mention_slugs),
    // Person author (author_persona_id), BlogPosting extras
    // (alternative_headline, target_keyword, citations).
    author_persona_id: authorPersonaId,
    alternative_headline: alternativeHeadline,
    target_keyword: targetKeyword,
    about_slugs: aboutSlugs,
    mention_slugs: mentionSlugs,
    speakable_selectors: speakableSelectors,
    typed_citations: typedCitations,
    dataset,
    item_list: itemList,
    how_to: howTo,
    quotes,
    claims,

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
export {
  findDeclarativeDrift,
  FORBIDDEN_DECLARATIVE_PHRASES,
  rewriteForTier,
  normalizePersonaId,
  normalizeSlugArray,
  normalizeSpeakableSelectors,
  normalizeCitations,
  normalizeDataset,
  normalizeItemList,
  normalizeHowTo,
  normalizeQuotes,
  normalizeClaims,
}
