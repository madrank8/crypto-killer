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
 * Dataset (CryptoKiller first-party data E-E-A-T), Quotation (authority quotes
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
import { createHash } from 'crypto'

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

// Published reviews must carry a substantive full_article body. If this is
// missing or too thin, we refuse sync so Replit cannot silently fall back to
// the legacy template path.
const MIN_FULL_ARTICLE_WORDS = 700

function sha256Hex(input) {
  return createHash('sha256').update(String(input ?? ''), 'utf8').digest('hex')
}

/** Must match Replit `artifacts/api-server/src/routes/sync.ts` — hashing must see identical bytes. */
function normalizeFullArticleForIntegrity(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u0000/g, '')
  try {
    s = s.normalize('NFC')
  } catch {
    /* ignore if runtime lacks normalize */
  }
  return s
}

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
    case 'title': {
      // Audit 2026-07-05 (R16): long brand names blew this template past 60
      // chars, and downstream blind cuts landed mid-word or right at the
      // pipe ("…and | CryptoKiller"). Drop the suffix when over budget.
      const full = `${safeName} Review — ${threat.score}/100 Threat Score | Crypto Killer`
      return full.length <= 60 ? full : truncateAtBoundary(`${safeName} Review — ${threat.score}/100 Threat Score`, 60)
    }
    case 'meta':
      return `${safeName} ${threat.prose}, scoring ${threat.score}/100. Crypto Killer investigation findings and red flags.`
    default:
      return `${safeName} ${threat.verdictOpener}.`
  }
}

/**
 * Boundary-aware truncation (audit 2026-07-05, R16). Cuts at the last word
 * boundary within `max` chars, then strips trailing punctuation/connector
 * words so a cut never ends in "and", "of", "—", "|" etc. — the renderer
 * appends " | CryptoKiller", so a trailing connector produced titles like
 * "…Deepfakes and | CryptoKiller".
 */
function truncateAtBoundary(input, max) {
  const s = String(input || '').trim()
  if (s.length <= max) return s
  let cut = s.slice(0, max + 1)
  const lastSpace = cut.lastIndexOf(' ')
  cut = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut.slice(0, max)).trim()
  // Strip trailing punctuation/symbols, then trailing connector words, then
  // any punctuation the connector strip exposed. Two passes handle
  // "…Deepfakes and —" style tails.
  for (let i = 0; i < 3; i++) {
    cut = cut
      .replace(/[\s,;:—–\-|&/+.]+$/g, '')
      .replace(/\s+(?:and|or|of|the|for|with|a|an|in|to|vs|by|on|at|from|is|are)$/i, '')
      .trim()
  }
  return cut
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
    return ['.key-takeaways', '.section-summary']
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
  // last30days community-report class: grounded last-30-day social posts.
  // These are the ONLY valid @types for a [COMMUNITY] citation — the writer
  // rule (lib/review-pipeline.js) forbids typing them GovernmentService/Report.
  // Both are schema.org CreativeWork subtypes, valid as an Article `citation`.
  'CreativeWork',
  'SocialMediaPosting',
])

// Citations pointing at these domains get dropped at normalize time.
// These are either (a) Google AI grounding-API redirects that leak from
// writer output (the Floventra / Cryptopygious case — the "source" was
// a grounding-redirect URL that the writer then simultaneously flagged
// in red_flags as a fabricated review), or (b) other known exfiltration
// wrappers that leak our writer's search tooling into production schema.
// The dynamic blocked-publisher list is built per-review in the caller
// from red_flags titles (see buildSyncPayload).
const STATIC_BLOCKED_CITATION_DOMAINS = [
  'cryptopygious.cloud.google.com',
  'grounding-api-redirect',
  'vertexaisearch.cloud.google.com',
]

function isBlockedCitationUrl(url) {
  if (typeof url !== 'string') return true
  const lower = url.toLowerCase()
  return STATIC_BLOCKED_CITATION_DOMAINS.some((d) => lower.includes(d))
}

function normalizeCitations(raw, { dynamicBlockedPublishers = [] } = {}) {
  if (!Array.isArray(raw)) return []
  const blockedPubs = new Set(
    dynamicBlockedPublishers
      .filter((s) => typeof s === 'string')
      .map((s) => s.toLowerCase().trim())
  )
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    if (typeof c.url !== 'string' || !c.url.startsWith('http')) continue
    if (isBlockedCitationUrl(c.url)) continue
    const pub = typeof c.publisher === 'string' ? c.publisher : null
    if (pub && blockedPubs.has(pub.toLowerCase().trim())) continue
    out.push({
      name: typeof c.name === 'string' ? c.name : c.url,
      url: c.url,
      type: VALID_CITATION_TYPES.has(c.type) ? c.type : 'WebPage',
      publisher: pub,
      datePublished: typeof c.datePublished === 'string' ? c.datePublished : null,
    })
  }
  return out
}

function normalizeDataset(raw, { brandName, brandSlug, siteUrl, observationWindow } = {}) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.name !== 'string' || typeof raw.description !== 'string') return null

  // Build distribution from the site itself — the review page IS the
  // machine-readable surface for this dataset. Without `distribution`
  // Google Dataset Search won't index the node, even when every other
  // required field is present.
  const distribution = siteUrl && brandSlug
    ? [
        {
          '@type': 'DataDownload',
          encodingFormat: 'text/html',
          contentUrl: `${siteUrl}/review/${brandSlug}`,
        },
      ]
    : []

  // Temporal coverage as ISO-8601 interval. Prefer explicit writer field;
  // fall back to the observation window from the CryptoKiller monitoring dates
  // passed by buildSyncPayload.
  let temporalCoverage = null
  if (typeof raw.temporalCoverage === 'string') {
    temporalCoverage = raw.temporalCoverage
  } else if (observationWindow?.start && observationWindow?.end) {
    temporalCoverage = `${observationWindow.start}/${observationWindow.end}`
  }

  const defaultKeywords = [brandName, 'scam intelligence', 'ad surveillance', 'CryptoKiller'].filter(
    (v) => typeof v === 'string' && v.length > 0
  )

  const legacyDatasetUrl = typeof raw.url === 'string' ? raw.url : null
  const normalizedDatasetUrl = (() => {
    if (!legacyDatasetUrl) return null
    if (/cryptokiller\.io\/data\/scam-brand-tracker/i.test(legacyDatasetUrl)) {
      return `${siteUrl}/methodology#dataset`
    }
    return legacyDatasetUrl
  })()

  return {
    '@id': siteUrl && brandSlug
      ? `${siteUrl}/review/${brandSlug}#cryptokiller-dataset`
      : null,
    name: raw.name,
    description: raw.description,
    url: normalizedDatasetUrl,
    datePublished: typeof raw.datePublished === 'string' ? raw.datePublished : null,
    temporalCoverage,
    variableMeasured: Array.isArray(raw.variableMeasured)
      ? raw.variableMeasured.filter((v) => typeof v === 'string').slice(0, 20)
      : [],
    spatialCoverage: Array.isArray(raw.spatialCoverage)
      ? raw.spatialCoverage.filter((v) => typeof v === 'string').slice(0, 30)
      : [],
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.filter((v) => typeof v === 'string').slice(0, 15)
      : defaultKeywords,
    license: typeof raw.license === 'string'
      ? raw.license
      : 'https://creativecommons.org/licenses/by/4.0/',
    distribution,
  }
}

/**
 * Normalize item_reviewed — the typed entity the review is ABOUT.
 * Writer v1.2+ emits { type, name, description, url, alternateName?, sameAs? }.
 * We guard type against the same whitelist as Replit, strip fabricated URLs,
 * and pass the shape through for Replit to build the final schema.org node
 * with @id and publisher reference.
 *
 * @param {object|null} raw - writer output (review.item_reviewed)
 * @param {object} opts
 * @param {string|null} opts.brandName - fallback when writer omits the field
 * @returns {object|null}
 */
function normalizeItemReviewed(raw, { brandName } = {}) {
  // ── Google review-snippet whitelist fix (2026-06-11) ──
  // Rich Results Test hard-fails with `Invalid object type for field
  // "itemReviewed"` when the referenced node's @type is outside Google's
  // supported list: Book, Course, CreativeWorkSeason, CreativeWorkSeries,
  // Episode, Event, Game, HowTo, LocalBusiness, MediaObject, Movie,
  // MusicPlaylist, MusicRecording, Organization, Product, Recipe,
  // SoftwareApplication. Subclass inference is NOT applied — FinancialProduct
  // (seen live on /review/crest-fundgrove) and Service both fail despite
  // being valid schema.org types.
  //
  // HISTORY: until 2026-06-11 the Replit renderer had its own narrower
  // whitelist ({FinancialProduct, Service, SoftwareApplication,
  // Organization}, 'Service' fallback) which forced this map down to the
  // {SoftwareApplication, Organization} intersection. The Replit-side
  // whitelist was extended same day (replit-handoff-2026-06-11.md Fix 2:
  // +Product, +LocalBusiness, fallback Organization), so the map now emits
  // the semantically better Google-valid types. If a live page ever renders
  // 'Service' on the #item-reviewed node again, the Replit fix regressed —
  // re-pin everything to Organization and re-check.
  const GOOGLE_TYPE_MAP = {
    FinancialProduct: 'Product',
    Service: 'Organization',
    SoftwareApplication: 'SoftwareApplication',
    MobileApplication: 'SoftwareApplication',
    Organization: 'Organization',
    LocalBusiness: 'LocalBusiness',
    Product: 'Product',
  }
  // No writer output → synthesize a minimal Organization node from the
  // brand row so Replit has SOMETHING typed to work with. Organization is
  // the safest Google-valid fallback — every scam brand is an operating
  // entity. (Previous fallback 'Service' is not rich-results eligible.)
  if (!raw || typeof raw !== 'object') {
    if (!brandName) return null
    return {
      type: 'Organization',
      name: brandName,
      description: `${brandName} — investigation subject.`,
      url: null,
      alternateName: null,
      sameAs: null,
    }
  }
  const type = GOOGLE_TYPE_MAP[raw.type] || 'Organization'
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : brandName
  if (!name) return null
  const description = typeof raw.description === 'string' && raw.description.trim()
    ? raw.description.trim()
    : null
  const url = typeof raw.url === 'string' && raw.url.startsWith('http') ? raw.url : null
  const alternateName = Array.isArray(raw.alternateName)
    ? raw.alternateName.filter((v) => typeof v === 'string' && v.trim()).slice(0, 5)
    : null
  const sameAs = Array.isArray(raw.sameAs)
    ? raw.sameAs.filter((v) => typeof v === 'string' && v.startsWith('http')).slice(0, 10)
    : null
  return {
    type,
    name,
    description,
    url,
    alternateName: alternateName && alternateName.length ? alternateName : null,
    sameAs: sameAs && sameAs.length ? sameAs : null,
  }
}

/**
 * Sort + flatten brand_landing_pages rows into the URL array
 * shapeReviewForSync expects in its options.landingUrls slot.
 *
 * Order of preference (first-match wins per appearance slot):
 *   1. archive_url where archive_status === 'success', most-recent-first
 *   2. live_url, most-recent-first
 *
 * The caller is expected to have already scoped rows to one brand.
 * Deduplicates by URL string so the same Wayback snapshot won't appear
 * twice even if there are multiple brand_landing_pages rows pointing
 * at it (there shouldn't be — live_url has a unique constraint — but
 * belt-and-braces the dedup anyway).
 *
 * @param {Array<{archive_url?: string|null, archive_status?: string|null,
 *                live_url?: string|null, captured_at?: string|null}>} rows
 * @returns {string[]}
 */
function normalizeBrandLandingUrls(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const byCaptured = (a, b) => {
    const av = a.captured_at || ''
    const bv = b.captured_at || ''
    if (av === bv) return 0
    return av < bv ? 1 : -1 // desc
  }
  const successes = rows
    .filter((r) => r && r.archive_status === 'success' && typeof r.archive_url === 'string' && r.archive_url.startsWith('http'))
    .sort(byCaptured)
    .map((r) => r.archive_url)
  const liveFallbacks = rows
    .filter((r) => r && typeof r.live_url === 'string' && r.live_url.startsWith('http'))
    .sort(byCaptured)
    .map((r) => r.live_url)
  const seen = new Set()
  const out = []
  for (const u of [...successes, ...liveFallbacks]) {
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

function normalizeItemList(raw) {
  // v1.2 writer emits { name, description, numberOfItems?, itemListOrder?, items: [...] }.
  // Older rows may have a bare array. Return the rich object when possible
  // so Replit's buildItemList can emit ItemList.name + description, which
  // are critical schema fields for celebrity-impersonation list pages.
  if (!raw) return null
  let items
  let listName = null
  let listDescription = null
  let numberOfItems = null
  let itemListOrder = null
  if (Array.isArray(raw)) {
    items = raw
  } else if (typeof raw === 'object' && Array.isArray(raw.items)) {
    items = raw.items
    if (typeof raw.name === 'string' && raw.name.trim()) listName = raw.name.trim()
    if (typeof raw.description === 'string' && raw.description.trim()) listDescription = raw.description.trim()
    if (typeof raw.numberOfItems === 'number' && raw.numberOfItems > 0) numberOfItems = raw.numberOfItems
    if (typeof raw.itemListOrder === 'string') itemListOrder = raw.itemListOrder
  } else {
    return null
  }
  const cleanItems = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.name !== 'string') continue
    cleanItems.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      entitySlug: typeof item.entitySlug === 'string' ? item.entitySlug : null,
    })
  }
  if (cleanItems.length === 0) return null
  return {
    ...(listName ? { name: listName } : {}),
    ...(listDescription ? { description: listDescription } : {}),
    ...(numberOfItems ? { numberOfItems } : {}),
    ...(itemListOrder ? { itemListOrder } : {}),
    items: cleanItems,
  }
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

// Case-insensitive lookup: normalized (trimmed + lowercased) → canonical
// label. Writers occasionally emit 'partly true' or ' False ' which would
// fail an exact Set.has() check and silently downgrade the ClaimReview
// rating to 'False' — a defamation-adjacent mislabel for fact-check schema.
const RATING_LABEL_LOOKUP = new Map(
  [...VALID_RATING_LABELS].map((label) => [label.toLowerCase(), label])
)

function normalizeClaims(raw, { brandName, adCreativeUrls = [] } = {}) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    if (typeof c.claimReviewed !== 'string') continue
    const ratingValue = Number.isFinite(c.ratingValue)
      ? Math.max(1, Math.min(5, Math.round(c.ratingValue)))
      : 1
    const ratingLabel =
      (typeof c.ratingLabel === 'string' &&
        RATING_LABEL_LOOKUP.get(c.ratingLabel.trim().toLowerCase())) ||
      'False'

    // Originator = speaker of the claim. Writer drifts into editorial
    // voice here ("Unknown scam operators") which bleeds into schema
    // and makes the ClaimReview harder for Google to attribute. The
    // claim is factually made BY the brand itself, so default to that.
    const originator =
      typeof c.originator === 'string' &&
      c.originator.trim() &&
      c.originator.trim() !== 'Unknown scam operators'
        ? c.originator.trim()
        : brandName || 'Unknown'

    // appearance = URL where the claim was made. Google Fact Check
    // rich results REQUIRE either `appearance` on the ClaimReview or
    // `itemReviewed.appearance`. Without it the node is ineligible for
    // Fact Check Explorer ingestion. Priority: explicit writer field →
    // writer's alternate `sourceUrl` → first tracked ad creative URL.
    const appearance =
      typeof c.appearance === 'string' && c.appearance.startsWith('http')
        ? c.appearance
        : typeof c.sourceUrl === 'string' && c.sourceUrl.startsWith('http')
          ? c.sourceUrl
          : adCreativeUrls.length > 0
            ? adCreativeUrls[0]
            : null

    out.push({
      claimReviewed: c.claimReviewed,
      ratingValue,
      ratingLabel,
      originator,
      appearance,
    })
  }
  return out
}

const VISUAL_PLACEHOLDER_RE =
  /\[\s*(IMAGE|CHART|DIAGRAM|INFOGRAPHIC|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED[^\]]*\]/gi

const PLACEHOLDER_SCRUB_NOTE_RE =
  /Editorial note:\s*requested\s+(?:image|chart|diagram|infographic|screenshot|photo|step-by-step|visual)\s+evidence\s+was\s+not\s+available\s+for\s+publication,\s+so\s+this\s+visual\s+placeholder\s+was\s+removed\s+before\s+save\./gi

// Drop content-image/chart/diagram placeholder markers the polish pipeline
// may or may not have resolved. A resolved image lives in visual_meta,
// content_images, or hero_image_url — not inline in prose.
function stripPlaceholders(text) {
  if (!text) return ''
  return text
    .replace(VISUAL_PLACEHOLDER_RE, '')
    .replace(PLACEHOLDER_SCRUB_NOTE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeFullArticleForTier(html, threat) {
  let out = stripPlaceholders(html)
  if (!out) return ''

  // Generated full_article HTML may contain above-the-fold labels that
  // predate tier-aware scoring. For non-confirmed tiers, keep visible copy
  // aligned with schema/title/rating and avoid "confirmed scam" drift.
  if (threat && !threat.frameAsScam) {
    out = out
      .replace(/\bCONFIRMED\s+SCAM\b/gi, threat.label || 'Under Investigation')
      .replace(/\bSCAM\s+ALERT\b/gi, threat.badge || 'INVESTIGATION')
  }

  return out
}

/**
 * Collect every human-prose field for coherence scanning. Mirrors the
 * collectProseFields helper in /api/admin/reviews/[id]/publish but
 * kept local to avoid a cross-file runtime import from a route file.
 * Returns [{ label, text }] with stable ordering.
 */
function collectReviewProse(review) {
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
  const rf = Array.isArray(review.red_flags) ? review.red_flags : []
  rf.forEach((r, i) => {
    push(`red_flags[${i}].flag`, r?.flag || r?.title)
    push(`red_flags[${i}].detail`, r?.detail || r?.description)
  })
  const faq = Array.isArray(review.faq) ? review.faq : []
  faq.forEach((f, i) => {
    push(`faq[${i}].question`, f?.question)
    push(`faq[${i}].answer`, f?.answer)
  })
  return fields
}

/**
 * Detect internal contradictions in a review. Each returned element
 * is { type, detail, evidence } describing a single conflict pair.
 *
 * Patterns caught (pragmatic list, grows by observation):
 *   (1) GEO EXCLUSIVITY FLIP — "all N creatives target X exclusively"
 *       + "creatives distributed outside X" in the same corpus.
 *   (2) CELEB COUNT DRIFT — the deduped celebrity count (derived from
 *       brand.celebrity_list via threat-score.dedupeCelebrityList) does
 *       not match the body's own stated count (e.g. body says "2
 *       celebrities" while stats block says "impersonating 8
 *       celebrities"). Caller passes brand so we can compute truth.
 *   (3) COUNTRY COUNT MISMATCH — brand.geo_list has N entries, body
 *       quotes a different N explicitly ("across M countries" where M ≠ N).
 *
 * These are auditable heuristics — they flag candidates for review, not
 * absolute truth. _coherence_contradictions in the sync payload tells
 * downstream (admin queue, Replit renderer) to pause and human-review.
 */
function detectInternalContradictions(review, brand) {
  const contradictions = []
  if (!review) return contradictions
  const fields = collectReviewProse(review)
  const corpus = fields.map((f) => f.text).join('\n')

  // (1) Geo exclusivity flip
  const geoExclMatch = corpus.match(/all\s+(\d+)\s+(?:ad\s+)?creatives?\s+target[^.]+?exclusively/i)
  const geoOutsideMatch = corpus.match(/(\d+)\s+creatives?\s+distributed\s+outside/i)
  if (geoExclMatch && geoOutsideMatch) {
    contradictions.push({
      type: 'geo_exclusivity_flip',
      detail: 'Text asserts geographic exclusivity AND distribution outside the same region.',
      evidence: [geoExclMatch[0].slice(0, 140), geoOutsideMatch[0].slice(0, 140)],
    })
  }

  // (2) Celebrity count drift
  try {
    const { dedupeCelebrityList } = require('./threat-score')
    const truthCount = dedupeCelebrityList(brand?.celebrity_list || []).length
    if (truthCount > 0) {
      // Find body claims of the form "N celebrities"
      const bodyCounts = [...corpus.matchAll(/\b(\d+)\s+(?:public\s+figures?|celebrit(?:y|ies))\b/gi)]
        .map((m) => Number(m[1]))
        .filter((n) => n > 0 && n < 100) // ignore nonsense
      const uniqueBodyCounts = [...new Set(bodyCounts)]
      const conflicting = uniqueBodyCounts.filter((n) => n !== truthCount)
      if (conflicting.length > 0) {
        contradictions.push({
          type: 'celeb_count_drift',
          detail: `Deduped truth count = ${truthCount}. Body mentions counts: ${uniqueBodyCounts.join(', ')}.`,
          evidence: [`derivedCelebCount=${truthCount}`, `bodyCounts=${uniqueBodyCounts.join(',')}`],
        })
      }
    }
  } catch {
    // threat-score.js unavailable; skip this check silently
  }

  // (3) Country count mismatch
  const geoList = Array.isArray(brand?.geo_list) ? brand.geo_list : []
  if (geoList.length > 0) {
    const bodyCountries = [...corpus.matchAll(/\b(\d+)\s+countr(?:y|ies)\b/gi)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 0 && n < 300)
    const uniqueBodyCountries = [...new Set(bodyCountries)]
    const conflicting = uniqueBodyCountries.filter((n) => n !== geoList.length)
    if (conflicting.length > 0) {
      contradictions.push({
        type: 'country_count_mismatch',
        detail: `brand.geo_list length = ${geoList.length}. Body mentions counts: ${uniqueBodyCountries.join(', ')}.`,
        evidence: [`truth=${geoList.length}`, `bodyCounts=${uniqueBodyCountries.join(',')}`],
      })
    }
  }

  return contradictions
}

// Parse the how_it_works text blob (EXACTLY 4 paragraphs per prompt) into
// structured funnel_stages[] that Replit's funnel_stages table expects.
// If >4 paragraphs (placeholder sneaked through), keep only the ones
// that look like real stages. If <4, pad rather than crash.
//
// 2026-04-28 — split-strategy resilience:
// Some writer outputs collapse the four paragraphs into one continuous
// string with INLINE stage separators (e.g. "...end of stage 1. STAGE 2 —
// THE FUNNEL: ..."). The original split was \n\n only, which produced 1
// paragraph instead of 4 and pushed all content into Stage 1 with
// Stages 2-4 silently empty. The WhatsApp Bot review's how_it_works
// stored exactly that shape (1909 chars, paragraph_count=1).
//
// Strategy:
//   1. Try \n\n split first (canonical form per the writer prompt).
//   2. If we got <4 paragraphs, fall back to inline-separator split
//      using a regex anchored on STAGE-N markers ("STAGE 1", "STAGE 2",
//      "STAGE 3", "STAGE 4" with — / : / . separators). The regex uses
//      a lookahead so the markers are preserved at the start of each
//      split chunk — that lets the per-paragraph stageMatch regex
//      below pull the title cleanly.
//   3. Even after fallback splitting, hard-cap to 4 stages so a
//      runaway STAGE 5+ marker doesn't synthesize phantom stages.
function parseFunnelStages(howItWorks, brandData) {
  if (!howItWorks || typeof howItWorks !== 'string') return []

  const cleaned = stripPlaceholders(howItWorks)

  // A chunk that is (almost) entirely image markup must never become a
  // funnel stage — that's the Crest Fundgrove "image-only Stage 2" bug
  // (2026-06-10). stripPlaceholders already removes [X NEEDED] tokens;
  // this catches polish-substituted <img>/<figure>/markdown-image chunks.
  const isProseChunk = (p) => {
    const stripped = p
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    return stripped.length > 40
  }

  // Pass 1 — canonical \n\n split.
  let paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter(isProseChunk)

  // Pass 2 — fall back to inline STAGE separator split when paragraphs
  // are missing. Lookahead preserves the STAGE marker at the start of
  // each split chunk so the title regex below can recognize it.
  if (paragraphs.length < 4) {
    const inlineSplit = cleaned
      .split(/(?=\bSTAGE\s+[1-4](?:\s*[—\-:]|\s+[A-Z]))/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter(isProseChunk)
    if (inlineSplit.length > paragraphs.length) {
      paragraphs = inlineSplit
    }
  }

  // Hard cap — never more than 4 stages even if the writer drifted into
  // a STAGE 5/6/7 sequence (which has happened on rare reviews).
  paragraphs = paragraphs.slice(0, 4)

  const stages = []
  for (let i = 0; i < 4; i++) {
    const raw = paragraphs[i] || ''
    // Match "STAGE N: Title. Description...", "STAGE N — Title: Description",
    // "STAGE N - Title. Description", or "N. Title. Description"
    const stageMatch = raw.match(/^(?:STAGE\s+\d+\s*[—\-:]\s*|Stage\s+\d+\s*[—\-:]\s*|\d+\.\s*)([^.:]+?)[.:]\s+(.+)$/s)
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
      // Audit 2026-07-05 (R11): use the DEDUPED celebrity count — the raw
      // aggregator total_celebrities can be inflated by accent/translit
      // duplicates, and the sidebar (stats.celebrities_abused) already uses
      // the deduped count. Two different counts on one page is the exact
      // Floventra 26-vs-28 self-contradiction.
      const stageCelebCount = Array.isArray(brandData?.celebrity_list)
        ? dedupeCelebrityList(brandData.celebrity_list).length
        : (brandData?.total_celebrities || 0)
      statLabel = stageCelebCount
        ? `impersonating ${stageCelebCount} celebrities`
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
export function shapeReviewForSync(review, brand, options = {}) {
  if (!review) return review

  // ── Landing URL sources for claims[].appearance ──
  // Path B wires three fallback tiers, in order of preference:
  //   1. options.landingUrls — archive-first URLs the caller pulled
  //      from brand_landing_pages (Wayback snapshots for public schema).
  //      This is the preferred source once migration 006 + the archive
  //      cron are in place. Caller passes a plain string[] already
  //      sorted archive-first; we treat the order as authoritative.
  //   2. review.ad_creative_urls — legacy per-review column that was
  //      never populated (scaffold left in place pre-Path B). Stays null
  //      in practice but supported in case someone wires it later.
  //   3. brand.landing_urls — raw SpyOwl linkUrls aggregated by
  //      migration 005's rebuild_brands. Live URLs only (no archive).
  //      Safety net so callers that don't explicitly pass archives still
  //      get *some* appearance URL; better-than-nothing degradation
  //      until the archive cron catches up on a new brand.
  const { landingUrls: optionsLandingUrls = null } = options

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
  let headlineText = review.headline ?? ''

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
    // Headline is the visible H1 / page-top text. Reuse the 'title' rewrite
    // role on drift — the canonical rewrite shape ("{brand} Review — N/100
    // Threat Score | Crypto Killer") is appropriate for both. No separate
    // role added to rewriteForTier to keep its switch surface tight.
    const hDrift = findDeclarativeDrift(headlineText)
    if (hDrift) {
      drift.headline = { original: headlineText, matched: hDrift }
      headlineText = rewriteForTier(brand?.name, 'title', threat)
    }
  }

  // ── Internal-contradiction coherence detector ──
  // The publish-time gate in /api/admin/reviews/[id]/publish catches the
  // cheapest contradiction shape (HK-exclusive vs outside-HK). Here we
  // go broader: scan every prose field for self-contradicting claim
  // pairs that would survive a naive gate. Contradictions don't block
  // sync — they're logged on _coherence_contradictions so the admin
  // queue can surface them, and Replit can refuse to render the page
  // if the array is non-empty.
  const contradictions = detectInternalContradictions(review, brand)

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

  const red_flags = (Array.isArray(review.red_flags) ? review.red_flags : []).map((rf, i) => {
    const src = rf || {}
    return {
      emoji: src.emoji || '🚩',
      title: src.title || src.flag || '',
      description: src.description || src.detail || '',
      order_index: i,
    }
  })

  const faq_items = (Array.isArray(review.faq) ? review.faq : []).map((q, i) => {
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
  //
  // ── PR4 (2026-04-23): schema-enrichment hardening ──
  // Three of the normalizers now take options objects with brand-level
  // context:
  //   - normalizeCitations: dynamicBlockedPublishers derived from red_flags
  //     titles (catches the Cryptopygious/"fabricated review" self-contradiction)
  //   - normalizeDataset: brandName/brandSlug/siteUrl/observationWindow
  //     (unlocks distribution + @id + temporalCoverage for Dataset rich results)
  //   - normalizeClaims: brandName + adCreativeUrls (unlocks appearance for
  //     Fact Check rich results and fixes "Unknown scam operators" originator)
  const personaFallback = threat.frameAsScam ? 'webb' : 'ortiz'
  const authorPersonaId = normalizePersonaId(review.author_persona_id, personaFallback)
  const aboutSlugs = normalizeSlugArray(review.about_slugs, { max: 5 })
  const mentionSlugs = normalizeSlugArray(review.mention_slugs, { max: 50 })
  const speakableSelectors = normalizeSpeakableSelectors(review.speakable_selectors)

  // Build dynamic blocked-publisher list from red_flag titles that flag
  // a "fabricated" / "planted" / "fake review" — tokens are then matched
  // against citation publishers to prevent self-contradicting citations
  // (the exact Floventra → Cryptopygious bug).
  const FABRICATED_REVIEW_MARKERS = [/fabricat/i, /planted/i, /fake review/i]
  const dynamicBlockedPublishers = (Array.isArray(review.red_flags) ? review.red_flags : [])
    .filter((rf) => {
      if (!rf || typeof rf !== 'object') return false
      const combined = `${rf.title || ''} ${rf.description || ''}`
      return FABRICATED_REVIEW_MARKERS.some((m) => m.test(combined))
    })
    .flatMap((rf) => {
      const combined = `${rf.title || ''} ${rf.description || ''}`
      return combined.match(/[A-Z][a-zA-Z]{4,}/g) || []
    })

  const adCreativeUrls = (() => {
    if (Array.isArray(optionsLandingUrls) && optionsLandingUrls.length > 0) {
      return optionsLandingUrls.filter((u) => typeof u === 'string' && u.startsWith('http'))
    }
    if (Array.isArray(review.ad_creative_urls) && review.ad_creative_urls.length > 0) {
      return review.ad_creative_urls.filter((u) => typeof u === 'string' && u.startsWith('http'))
    }
    if (Array.isArray(brand?.landing_urls) && brand.landing_urls.length > 0) {
      return brand.landing_urls.filter((u) => typeof u === 'string' && u.startsWith('http'))
    }
    return []
  })()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://cryptokiller.org'

  // Observation window for Dataset.temporalCoverage — pull from the
  // brand row's CryptoKiller first/last seen timestamps (source of truth),
  // not a per-review column. If the brand row is missing dates, the
  // normalizer skips temporalCoverage and ships Dataset without it
  // (still valid schema, just one less E-E-A-T signal).
  const toIsoDate = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v.slice(0, 10)
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return null
  }
  const observationWindow = {
    start: toIsoDate(brand?.first_seen_at),
    end: toIsoDate(brand?.last_seen_at),
  }

  const typedCitations = normalizeCitations(review.citations, { dynamicBlockedPublishers })
  const dataset = normalizeDataset(review.dataset, {
    brandName: brand?.name || review.brand_name || null,
    brandSlug: review.slug || review.brand_slug || null,
    siteUrl,
    observationWindow,
  })
  const itemReviewed = normalizeItemReviewed(review.item_reviewed, {
    brandName: brand?.name || review.brand_name || null,
  })
  const itemList = normalizeItemList(review.item_list)
  const howTo = normalizeHowTo(review.how_to)
  const quotes = normalizeQuotes(review.quotes)
  const claims = normalizeClaims(review.claims, {
    brandName: brand?.name || review.brand_name || null,
    adCreativeUrls,
  })
  const alternativeHeadline =
    typeof review.alternative_headline === 'string' && review.alternative_headline.trim()
      ? truncateAtBoundary(review.alternative_headline, 110)
      : null
  const targetKeyword =
    typeof review.target_keyword === 'string' && review.target_keyword.trim()
      ? review.target_keyword.trim().toLowerCase()
      : brand?.name
      ? `${brand.name.toLowerCase()} scam`
      : null

  const normalizedFullArticle = normalizeFullArticleForIntegrity(
    normalizeFullArticleForTier(
      typeof review.full_article === 'string' ? review.full_article : '',
      threat,
    ),
  )
  const fullArticleLength = normalizedFullArticle.length
  const fullArticleHash = sha256Hex(normalizedFullArticle)
  const fullArticleWordCount = normalizedFullArticle
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

  if ((review.status ?? 'published') === 'published' && fullArticleWordCount < MIN_FULL_ARTICLE_WORDS) {
    throw new Error(
      `[sync-shape] refusing to sync published review "${review.slug}" without full_article ` +
        `content (words=${fullArticleWordCount}, min=${MIN_FULL_ARTICLE_WORDS}).`
    )
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
    headline: headlineText,
    verdict: verdictText,
    summary: summaryText,
    meta_description: metaText,
    hero_description: heroDescription,
    warning_callout: warningCallout,
    investigation_date: review.review_date || review.published_at || new Date().toISOString(),
    methodology_text: methodologyText,
    disclaimer_text: disclaimerText,
    full_article: normalizedFullArticle,
    full_article_length: fullArticleLength,
    full_article_hash: fullArticleHash,
    word_count: review.word_count ?? 0,
    reading_minutes: readingMinutes,
    author: review.author_name ?? 'Crypto Killer Research Team',

    // Audit trail — if we rewrote any prose because of tier drift, the
    // original text is preserved here so admin can see what the writer
    // drifted into. Replit should NOT render these; they are for the
    // sync log / admin review queue only.
    _coherence_drift: Object.keys(drift).length > 0 ? drift : null,

    // Audit trail — internal contradictions detected at sync time
    // (conflicting numeric claims, geo exclusivity flips, count drift
    // between body and schema). Populated by detectInternalContradictions.
    // Replit MUST NOT render a page where this is non-null without
    // admin review — it indicates the writer contradicted itself.
    _coherence_contradictions: contradictions.length > 0 ? contradictions : null,

    // Rich-content columns (migration 0002 on Replit). These back the hero
    // image, inline images, chart/diagram visuals, sources list, protection
    // steps, "when this review may not apply" qualifier, and expertise-depth
    // block on the live page. Before 2026-04-21 these were all silently
    // dropped because Replit had no columns for them.
    hero_image_url: review.hero_image_url || null,
    hero_image_alt: review.hero_image_alt || null,
    hero_image_credit: review.hero_image_credit || null,
    content_images: contentImages,
    // Structured scraped ad-creative evidence — the renderer displays it as a
    // dedicated "Fraudulent Ad Creatives by Country" section. Shape:
    // { images: [{ geo, celebrity, url }], geoCounts: { GEO: count } }.
    ad_evidence: (review.ad_evidence && typeof review.ad_evidence === 'object') ? review.ad_evidence : null,
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
    item_reviewed: itemReviewed,
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

    // ─── Translations (multi-locale, V1 added 2026-05) ──────────────────
    // Replit consumer reads this array to:
    //   1. Provision /[locale]/review/[slug] routes for each entry
    //      (URL-locale segment is locale.toLowerCase() — e.g. 'pt-BR' → 'pt-br')
    //   2. Emit <link rel="alternate" hreflang="..."> tags on both the EN
    //      master and each translation, all pointing back at each other
    //      bidirectionally (Google requires return-link reciprocity)
    //   3. Add <meta name="googlebot" content="notranslate"> on the EN
    //      master when this array has ≥1 published entry (so Google's
    //      auto-translation feature doesn't compete with our manual ones)
    //   4. Add Sitemap xhtml:link alternates per Google's i18n sitemap spec
    //   5. Set <html lang="..."> and JSON-LD inLanguage to the translation's
    //      BCP-47 code
    //
    // V1 locales: en (master) + it, es, de, fr, pt-BR.
    // Schema cross-reference: master Review JSON-LD adds
    //   workTranslation: [{ "@id": "<translation_url>#review" }, ...]
    // and each translation adds translationOfWork pointing at master.
    //
    // See docs/REPLIT_TRANSLATIONS_HANDOFF.md (Vercel repo) for the full
    // consumer-side spec including required render fields and a JSON-LD
    // example.
    translations: Array.isArray(options.translations)
      ? options.translations.map((t) => ({
          locale: t.locale,
          slug: t.slug,
          status: t.status,
          title: t.title,
          meta_description: t.meta_description,
          headline: t.headline,
          alternative_headline: t.alternative_headline,
          summary: t.summary,
          verdict: t.verdict,
          how_it_works: t.how_it_works,
          full_article: t.full_article,
          red_flags: Array.isArray(t.red_flags) ? t.red_flags : [],
          faq: Array.isArray(t.faq) ? t.faq : [],
          key_takeaways: Array.isArray(t.key_takeaways) ? t.key_takeaways : [],
          not_for_you: t.not_for_you,
          protection_steps: t.protection_steps,
          methodology: t.methodology,
          disclaimer: t.disclaimer,
          expertise_depth: t.expertise_depth,
          // Provenance for the translator byline + AI disclosure block
          translation_method: t.translation_method,
          translator_name: t.translator_name,
          translator_credentials: t.translator_credentials,
          ai_model: t.ai_model,
          ai_prompt_version: t.ai_prompt_version,
          reviewed_at: t.reviewed_at,
          word_count: t.word_count,
          published_at: t.published_at,
          source_review_updated_at: t.source_review_updated_at,
          updated_at: t.updated_at,
        }))
      : [],

    // ─── Geo pressure (top targeted countries), added 2026-07-08 ────────
    // Replit renders this as the "Heaviest-hit countries" flag widget inside
    // the Ad Velocity card on the review page (flag chips ranked by ad
    // count, #1 highlighted, share bars scaled to the leader).
    //
    // Source: scam_brands.geo_breakdown — maintained by rebuild_brands() on
    // every scrape as the top-5 geos per brand: [{ geo, n, share }] where
    // `share` is the fraction of ALL the brand's creatives (0-1, 3dp).
    // We reshape to renderer-friendly names and drop malformed rows so the
    // widget can trust every entry: [{ code: 'HR', ads: 21, share: 0.124 }].
    // Empty array → Replit hides the widget entirely (no empty box).
    geo_pressure: Array.isArray(brand?.geo_breakdown)
      ? brand.geo_breakdown
          .filter((g) => g && typeof g.geo === 'string' && g.geo.trim() && Number.isFinite(Number(g.n)))
          .slice(0, 5)
          .map((g) => ({
            code: g.geo.trim().toUpperCase(),
            ads: Number(g.n),
            share: Number.isFinite(Number(g.share)) ? Number(g.share) : 0,
          }))
      : [],

    // ─── Recent ad evidence (last 7 days), added 2026-05-18 ─────────────
    // Replit consumer renders this as a small "Ads scraped this week" grid
    // next to the Ad Velocity widget on the review page. Each card surfaces
    // the EVIDENCE we have: which celebrity was impersonated, which country
    // was targeted, the actual scam ad copy (mainText), the FB post URL.
    //
    // We deliberately ship a metadata-only payload (no images):
    //   - SpyOwl's API doesn't expose ad images (probed 2026-05-18)
    //   - Specific evidence (named celebrity + scam copy + landing domain)
    //     is a stronger E-E-A-T signal than a blurry thumbnail
    //   - Replit can fetch og:image lazily on render as a later enhancement
    //
    // Caller passes options.recentAds as the result of a creatives + creative_text
    // join filtered to last-7d + this brand + ordered by first_seen_at DESC + limit 20.
    // See app/api/admin/reviews/[id]/sync/route.js for the query.
    //
    // Fields included per ad (small + privacy-conscious — full link_url has
    // 500+ chars of UTM tags that aren't useful for display):
    //   - creative_id   (stable id for React keys + future linking)
    //   - offer_name    (always "Senvix" etc; helpful when brand has aliases)
    //   - celebrity_name (comma-separated names like "Ana Botín, Felipe VI")
    //   - geo           (ISO country code, render as flag)
    //   - land_language (ISO lang code)
    //   - is_video      (boolean — render a play icon overlay)
    //   - first_seen_at (when WE first scraped it — drives "3d ago")
    //   - spyowl_created_at (when SpyOwl first saw it on Meta)
    //   - main_text     (the ad copy — truncated to 280 chars to bound payload)
    //   - link_text     (button label or null)
    //   - link_domain   (just the hostname of the landing URL — full UTM URL stripped)
    //   - post_url      (Facebook post permalink — clickable "View on Facebook")
    //   - fp_link       (Facebook page URL)
    recent_ads_sample: Array.isArray(options.recentAds)
      ? options.recentAds.slice(0, 20).map((a) => {
          // Surface the landing URL as just the host so display stays compact
          // and we don't leak our scraping infra by exposing UTM tags publicly.
          let linkDomain = null
          try {
            if (a.link_url) linkDomain = new URL(a.link_url).hostname
          } catch { /* malformed URL */ }
          const mainText = typeof a.main_text === 'string'
            ? a.main_text.length > 280 ? a.main_text.slice(0, 277) + '…' : a.main_text
            : null
          return {
            creative_id: a.creative_id || a.id,
            offer_name: a.offer_name,
            celebrity_name: a.celebrity_name || null,
            geo: a.geo,
            land_language: a.land_language || null,
            is_video: !!a.is_video,
            first_seen_at: a.first_seen_at,
            spyowl_created_at: a.spyowl_created_at || a.created_at,
            main_text: mainText,
            // link_text occasionally contains Facebook's cookie-consent banner
            // text that bled into the scrape (the scraper grabs everything in
            // the link-text DOM node, including unrelated FB UI). Filter it
            // at the sync source so every downstream renderer gets clean data.
            link_text: isCookieBoilerplate(a.link_text) ? null : (a.link_text || null),
            link_domain: linkDomain,
            post_url: a.post_url || null,
            fp_link: a.fp_link || null,
          }
        })
      : [],
  }
}

// Facebook's cookie-consent banner text that occasionally leaks into the
// scraped link_text field. Patterns derived from inspecting real Senvix
// creatives in production (2026-05-18). Case-insensitive, trimmed.
const COOKIE_BOILERPLATE_RE = /^(cookies (from|notice|policy|preferences)|we use cookies|this (site|page) uses cookies|privacy and cookies|privacy policy)\b/i

function isCookieBoilerplate(text) {
  if (!text || typeof text !== 'string') return false
  return COOKIE_BOILERPLATE_RE.test(text.trim())
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
  normalizeItemReviewed,
  normalizeBrandLandingUrls,
  normalizeItemList,
  normalizeHowTo,
  normalizeQuotes,
  normalizeClaims,
  truncateAtBoundary,
}
