/**
 * Review Schema Generator — 2026-Compliant
 *
 * Builds JSON-LD structured data following the schema-markup-generator skill:
 * - Full @graph with @id cross-references
 * - GEO/AI visibility layer (knowsAbout, sameAs, subjectOf)
 * - NO ClaimReview (deprecated Jan 2026)
 * - Dynamic production URL
 * - WebPage entity (was missing)
 * - Authority layer on Organization
 * - Content-schema parity
 *
 * ─── PR3: itemReviewed + reviewRating fix (2026-04-21) ───
 *
 * Two separate bugs shipped on the Affitto Casa review page:
 *
 * 1. itemReviewed hardcoded "Cryptocurrency investment platform" even
 *    when the brand was an Italian rental real-estate scam. CryptoKiller
 *    now surveilles rental, romance, Rx/telehealth, and forex scam funnels
 *    in addition to crypto — the schema must match the entity type.
 *    Google's spam classifier treats type/description mismatches as a
 *    low-quality-review-farm signal and demotes accordingly.
 *
 * 2. reviewRating was computed as:
 *       ratingValue: Math.max(1, Math.round((100 - scam_score) / 20))
 *    For scam_score=3, that produced ratingValue=5 on a "Confirmed Scam"
 *    review. Google displays rich results from reviewRating as STAR RATINGS
 *    — so the Affitto Casa schema was telling Google "5 stars for this
 *    rental scam". The inverted polarity is not decoded by consumers; any
 *    rich result eligibility flips against us.
 *
 * Fix:
 *   - itemReviewed now accepts brand.entity_type ('Product' | 'Service' |
 *     'RealEstateAgent' | 'LocalBusiness' | 'Organization') with a safe
 *     fallback to 'Thing' (broadest) rather than wrongly-specific 'Product'.
 *     Description pulls from brand.description if present, else a neutral
 *     "Platform under investigation by Crypto Killer" — never a hardcoded
 *     "crypto trading platform" string.
 *   - reviewRating follows tier polarity: for frameAsScam=true (tiers
 *     'confirmed' and 'high'), rating=1/5 with worstRating=1 bestRating=5
 *     meaning "1 star, worst". For 'elevated' and 'watchlist', rating=2/5
 *     and 3/5 respectively. For 'low' tier, reviewRating is OMITTED
 *     entirely — we don't ship a star rating on reviews where the
 *     evidence doesn't clear the caution threshold, because a hedged
 *     "low signal" review with ANY star rating reads as editorial overreach.
 *   - Organization.sameAs now reads from env vars (CRYPTOKILLER_LINKEDIN_URL
 *     etc.) with empty-array fallback — gives ops a surface to fill in
 *     without another code change.
 *   - Author Person schema made more defensible: knowsAbout resolved from
 *     the review's about_slugs when available (so the author's claimed
 *     expertise matches the topic of this specific article).
 *   - HowTo prefers writer-generated brand-specific steps (PR2 passthrough
 *     in sync-shape) over the generic 5-step fallback.
 *   - Article gains alternativeHeadline and keywords (target_keyword) from
 *     the PR2 enrichment fields when present.
 */

// Canonical site URL for schema @ids — always returns the public SEO URL
// (cryptokiller.org), not the admin preview host. This module is imported by
// both the Vercel admin /review/<slug> preview AND the schema_json column
// that gets synced to Replit. In both cases the @id must point at the
// canonical Review entity served at cryptokiller.org, not the Vercel admin
// host or a stale base44.app URL.
//
// NEXT_PUBLIC_SITE_URL is honored as an override (useful for legitimate
// preview/dev environments like crypto-killer-git-foo.vercel.app), BUT
// known-stale hosts (base44.app, the production vercel.app admin host,
// localhost) are actively rejected so the schema @id never points at the
// wrong canonical URL even when the env var was never updated after the
// migration off base44. Matches the pattern in lib/sync-shape.js:1068.
const CANONICAL_SITE_URL = 'https://cryptokiller.org'
const REJECTED_HOST_FRAGMENTS = [
  'base44.app',
  'crypto-killer.vercel.app',
  'localhost',
  '127.0.0.1',
]
function getSiteUrl() {
  const override = (process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (!override) return CANONICAL_SITE_URL
  // Reject legacy/admin/local hosts — these would leak into schema @ids
  if (REJECTED_HOST_FRAGMENTS.some(h => override.includes(h))) {
    return CANONICAL_SITE_URL
  }
  return override
}

// Map brand.entity_type (semantic, writer-facing) to a Google-valid
// itemReviewed @type. The Rich Results Test hard-fails with `Invalid
// object type for field "itemReviewed"` for any @type outside Google's
// review-snippet whitelist (Book, Course, CreativeWorkSeason,
// CreativeWorkSeries, Episode, Event, Game, HowTo, LocalBusiness,
// MediaObject, Movie, MusicPlaylist, MusicRecording, Organization,
// Product, Recipe, SoftwareApplication) — subclass inference is NOT
// applied, so FinancialProduct, Service, WebSite and Thing all fail
// (seen live on /review/crest-fundgrove, 2026-06-11).
//
// We keep accepting the semantic types as input but emit the nearest
// whitelisted type. Fallback is 'Organization' (every scam brand is an
// operating entity) — never 'Thing', which kills rich-result eligibility.
const ENTITY_TYPE_TO_GOOGLE = {
  Product: 'Product',
  Service: 'Organization',
  SoftwareApplication: 'SoftwareApplication',
  MobileApplication: 'SoftwareApplication',
  FinancialProduct: 'Product',
  InvestmentFund: 'Product',
  RealEstateAgent: 'LocalBusiness',
  LocalBusiness: 'LocalBusiness',
  Organization: 'Organization',
  WebSite: 'Organization',
  Thing: 'Organization',
}

function resolveItemReviewedType(entityType) {
  if (typeof entityType === 'string' && ENTITY_TYPE_TO_GOOGLE[entityType]) {
    return ENTITY_TYPE_TO_GOOGLE[entityType]
  }
  return 'Organization'
}

// Map threat tier to a star rating with correct polarity. Returns null
// when the tier doesn't warrant a public star rating at all (tier=low).
//
// Google Rich Results uses reviewRating to render stars; a star rating
// on a "low signal" article is both defamation-risky and editorially
// weak. Better to ship no rating than an inverted one.
function resolveReviewRating(threat) {
  if (!threat) return null
  switch (threat.tier) {
    case 'confirmed':
      return { value: 1, explanation: 'Confirmed scam. Avoid all contact.' }
    case 'high':
      return { value: 1, explanation: 'Very high risk. Evidence of fraudulent activity.' }
    case 'elevated':
      return { value: 2, explanation: 'Multiple serious red flags. Exercise extreme caution.' }
    case 'watchlist':
      return { value: 3, explanation: 'Under investigation. Verify before depositing.' }
    case 'low':
      return null // no star rating — evidence doesn't clear the threshold
    default:
      return null
  }
}

// Pull sameAs targets for the Organization entity from env vars.
// Returns an empty array if none are set — Google tolerates empty
// sameAs; it does NOT tolerate sameAs pointing at 404s or broken
// profiles, so we only include what's explicitly configured.
function orgSameAs() {
  const candidates = [
    process.env.CRYPTOKILLER_LINKEDIN_URL,
    process.env.CRYPTOKILLER_TWITTER_URL,
    process.env.CRYPTOKILLER_CRUNCHBASE_URL,
    process.env.CRYPTOKILLER_WIKIDATA_URL,
    process.env.CRYPTOKILLER_GITHUB_URL,
  ]
  return candidates.filter((u) => typeof u === 'string' && u.startsWith('http'))
}

/**
 * Build complete JSON-LD schema for a review page.
 *
 * `threat` is the classifyThreat() result from lib/threat-score. If
 * omitted, the function falls back to scoring brandData.scam_score
 * inline — but callers SHOULD pass `threat` so the same tier decision
 * drives both the schema and the rendered prose.
 *
 * `brandData.entity_type` is the schema.org @type for itemReviewed
 * ('RealEstateAgent', 'Product', 'Service', etc.). When absent, falls
 * back to 'Thing' rather than the previous 'Product' default.
 */
function buildReviewSchema({
  reviewContent,
  brandData,
  slug,
  currentDate,
  wordCount,
  longevityDays,
  threat,
  // ── PR4 (2026-04-23): schema enrichment payload ──
  // Accepts the same-shape output that sync-shape.js normalizers produce.
  // Callers that read review row fields directly should pass these in;
  // admin preview routes can leave them empty and the graph degrades
  // gracefully (Dataset/ClaimReview/ItemList nodes are skipped, the rest
  // renders normally).
  dataset = null,
  claims = [],
  itemList = [],
  typedCitations = [],
}) {
  const siteUrl = getSiteUrl()
  const reviewUrl = `${siteUrl}/review/${slug}`

  // Defensive import fallback — if no classified threat was passed in,
  // we still need ONE. Require here so the file doesn't force a circular
  // import for callers that don't need it.
  if (!threat) {
    try {
      const { classifyThreat } = require('./threat-score')
      threat = classifyThreat(brandData?.scam_score ?? 0)
    } catch {
      // Absolute fallback — treat as 'low' and omit rating.
      threat = {
        tier: 'low',
        score: 0,
        label: 'Low Signal',
        frameAsScam: false,
        prose: 'shows limited signals in current surveillance data',
      }
    }
  }

  const itemReviewedType = resolveItemReviewedType(brandData?.entity_type)
  const itemReviewedDescription =
    (typeof brandData?.description === 'string' && brandData.description.trim()) ||
    `Platform under investigation by Crypto Killer. Threat score ${brandData?.scam_score ?? 0}/100.`

  const rating = resolveReviewRating(threat)

  return {
    '@context': 'https://schema.org',
    '@graph': [

      // ── Organization Entity (Foundation + Authority Layer) ──
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Crypto Killer',
        url: siteUrl,
        description: 'Scam intelligence platform powered by our proprietary CryptoKiller ad surveillance technology. Analyzes fraudulent advertising campaigns and cross-checks every investigated brand against official regulatory databases — including the UK FCA Financial Services Register and Warning List (via the FCA’s register API) and US SEC EDGAR filings — to protect consumers from cryptocurrency investment scams.',
        knowsAbout: [
          'Cryptocurrency Scam Detection',
          'Crypto Fraud Investigation',
          'Ad Surveillance Technology',
          'Investment Scam Analysis',
          'Celebrity Impersonation Fraud',
          'Financial Consumer Protection',
          'Digital Advertising Fraud Detection',
          'Blockchain Scam Intelligence',
          'FCA Financial Services Register Verification',
          'SEC EDGAR Regulatory Cross-Referencing',
        ],
        sameAs: orgSameAs(),
        alternateName: ['CryptoKiller', 'Crypto Killer Intelligence'],
        areaServed: {
          '@type': 'Place',
          name: 'Worldwide',
        },
        logo: {
          '@type': 'ImageObject',
          url: `${siteUrl}/logo.png`,
          width: 512,
          height: 512,
        },
      },

      // ── Person/Author Entity (Expertise + Experience) ──
      //
      // `knowsAbout` pulls from the review's about_slugs when available
      // so the author's claimed expertise topics match THIS article's
      // topic. Falls back to a generic crypto-fraud expertise list.
      {
        '@type': 'Person',
        '@id': `${siteUrl}/#author`,
        name: 'Crypto Killer Research Team',
        jobTitle: 'Crypto Fraud Intelligence Analysts',
        worksFor: { '@id': `${siteUrl}/#organization` },
        description: reviewContent.expertise_depth || 'Specialists in ad surveillance, blockchain analysis, and financial fraud pattern recognition. Every investigation is cross-checked against the FCA Financial Services Register, the FCA Warning List, and SEC EDGAR.',
        knowsAbout:
          Array.isArray(reviewContent.about_slugs) && reviewContent.about_slugs.length > 0
            ? reviewContent.about_slugs.map((s) => s.replace(/-/g, ' '))
            : [
                'Cryptocurrency Fraud Investigation',
                'Ad Surveillance Analysis',
                'Scam Pattern Recognition',
                'Financial Regulatory Compliance',
                'WHOIS Analysis',
                'SSL Certificate Inspection',
                'Payment Processor Identification',
              ],
        hasCredential: {
          '@type': 'EducationalOccupationalCredential',
          credentialCategory: 'Professional Experience',
          description: `CryptoKiller ad surveillance platform operators with intelligence on 500+ scam brands, cross-referenced against official regulator databases (FCA register API, FCA Warning List, SEC EDGAR).`,
        },
      },

      // ── WebSite Entity ──
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: siteUrl,
        name: 'Crypto Killer',
        description: 'Crypto scam intelligence and investigation platform',
        publisher: { '@id': `${siteUrl}/#organization` },
        inLanguage: 'en-US',
      },

      // ── WebPage Entity (was MISSING — required by schema-markup-generator) ──
      {
        '@type': 'WebPage',
        '@id': `${reviewUrl}#webpage`,
        url: reviewUrl,
        name: reviewContent.title || `${brandData.name} Scam Review`,
        description: reviewContent.meta_description || `Investigation of ${brandData.name} crypto scam.`,
        isPartOf: { '@id': `${siteUrl}/#website` },
        breadcrumb: { '@id': `${reviewUrl}#breadcrumb` },
        primaryImageOfPage: reviewContent.heroImage ? {
          '@type': 'ImageObject',
          url: reviewContent.heroImage,
        } : undefined,
        datePublished: currentDate,
        dateModified: currentDate,
        inLanguage: 'en-US',
        ...(dataset ? { mainEntity: { '@id': `${reviewUrl}#cryptokiller-dataset` } } : {}),
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector:
            Array.isArray(reviewContent.speakable_selectors) &&
            reviewContent.speakable_selectors.length > 0
              ? reviewContent.speakable_selectors
              : ['h1', 'h2', '.key-takeaways', '.verdict'],
        },
      },

      // ── Article Entity (primary content) ──
      {
        '@type': 'Article',
        '@id': `${reviewUrl}#article`,
        headline: reviewContent.headline || reviewContent.title,
        alternativeHeadline: reviewContent.alternative_headline || undefined,
        keywords: reviewContent.target_keyword || undefined,
        description: reviewContent.meta_description,
        datePublished: currentDate,
        dateModified: currentDate,
        wordCount: wordCount,
        // YMYL + scam-investigation content is always free to read —
        // omitting this field lets some classifiers assume a paywall
        // and demote. Explicit `true` earns us Google's "free content"
        // badge on News/Discover surfaces.
        isAccessibleForFree: true,
        author: { '@id': `${siteUrl}/#author` },
        publisher: { '@id': `${siteUrl}/#organization` },
        isPartOf: { '@id': `${siteUrl}/#website` },
        mainEntityOfPage: { '@id': `${reviewUrl}#webpage` },
        inLanguage: 'en-US',
        about: [
          {
            '@type': resolveItemReviewedType(brandData?.entity_type),
            name: brandData.name,
            description: `Platform under investigation. ${threat.score}/100 threat score${threat.tier ? ` (${threat.tier} tier)` : ''}.`,
          },
          {
            '@type': 'Thing',
            name: 'Cryptocurrency Scam',
            sameAs: 'https://www.wikidata.org/wiki/Q110551885',
          },
        ],
        // Mentions derive from the DEDUPED celebrity list + geo list.
        // Previously used brandData.celebrity_list raw, which leaked
        // CSV-joined strings ("Law Ka-chung, Paul Chan") as a single
        // Person name — emitted to schema as one Person when it's two.
        // Also picks the first 8 people instead of 5 (Google handles
        // arbitrary mentions length well; 5 was overly conservative).
        mentions: [
          ...(() => {
            try {
              const { dedupeCelebrityList } = require('./threat-score')
              return dedupeCelebrityList(brandData.celebrity_list || []).slice(0, 8)
            } catch {
              return (brandData.celebrity_list || []).slice(0, 8)
            }
          })().map((celeb) => ({
            '@type': 'Person',
            name: celeb,
          })),
          ...(brandData.geo_list || []).slice(0, 8).map((geo) => ({
            '@type': 'Country',
            name: geo,
          })),
        ],
        // Prefer typed citations from sync-shape normalizers (they strip
        // grounding-API-redirect URLs and publishers flagged as fabricated
        // in red_flags). Fall back to the raw sources array for backward
        // compat — but `WebPage` is the correct fallback @type, not
        // `CreativeWork` which Google treats as a weak signal.
        citation:
          Array.isArray(typedCitations) && typedCitations.length > 0
            ? typedCitations.map((c) => ({
                '@type': c.type,
                name: c.name,
                url: c.url,
                ...(c.publisher
                  ? { publisher: { '@type': 'Organization', name: c.publisher } }
                  : {}),
                ...(c.datePublished ? { datePublished: c.datePublished } : {}),
              }))
            : (reviewContent.sources || []).map((s) => ({
                '@type': 'WebPage',
                name: s.title,
                url: s.url,
              })),

        // isBasedOn — the Article's central claim is derived from the
        // CryptoKiller dataset node (emitted below). Making this edge explicit
        // converts the review from "opinion piece" to "evidence-backed
        // investigation" in Google's content-quality graph, and gives
        // Google Dataset Search a surface to discover the dataset from
        // the Article node.
        ...(dataset
          ? { isBasedOn: { '@id': `${reviewUrl}#cryptokiller-dataset` } }
          : {}),
      },

      // ── Review Entity ──
      // itemReviewed @type is resolved from brandData.entity_type. No more
      // hardcoded "Cryptocurrency investment platform" description leaking
      // onto non-crypto scam reviews.
      // reviewRating follows tier polarity: low tier → no rating at all.
      {
        '@type': 'Review',
        '@id': `${reviewUrl}#review`,
        // Mirror isAccessibleForFree on the Review node as well; some
        // classifiers check the Review entity directly for paywall state.
        isAccessibleForFree: true,
        itemReviewed: {
          '@type': itemReviewedType,
          name: brandData.name,
          description: itemReviewedDescription,
          ...(brandData?.category ? { category: brandData.category } : {}),
          ...(brandData?.url ? { url: brandData.url } : {}),
        },
        ...(rating
          ? {
              reviewRating: {
                '@type': 'Rating',
                ratingValue: rating.value,
                bestRating: 5,
                worstRating: 1,
                ratingExplanation: `${rating.explanation} Based on ${brandData.total_creatives || 0} ad creatives across ${brandData.total_geos || 0} countries over ${longevityDays || 0} days.`,
              },
            }
          : {}),
        author: { '@id': `${siteUrl}/#author` },
        publisher: { '@id': `${siteUrl}/#organization` },
        reviewBody: reviewContent.verdict,
        datePublished: currentDate,
      },

      // ── FAQPage Entity ──
      ...(reviewContent.faq && reviewContent.faq.length > 0 ? [{
        '@type': 'FAQPage',
        '@id': `${reviewUrl}#faqpage`,
        inLanguage: 'en-US',
        mainEntity: reviewContent.faq.map(f => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: f.answer,
          },
        })),
      }] : []),

      // ── HowTo Entity (AI-extractable) ──
      //
      // Prefer the LLM-generated how_to object (PR2 passthrough) when
      // available — it's tailored to this specific brand. Fall back to
      // the generic 5-step template when the writer didn't emit one.
      //
      // HOTFIX 2026-04-22: Accept both `step` (schema.org canonical name)
      // and `steps` (legacy/conventional). Guard against the LLM emitting
      // a truthy `how_to` without a valid array — previously crashed with
      // "Cannot read properties of undefined (reading 'map')" when the
      // writer followed the prompt (which said "step: [...]") but the
      // builder hard-required `.steps` (plural).
      ...((() => {
        const lh = reviewContent.how_to
        const rawSteps = Array.isArray(lh?.steps)
          ? lh.steps
          : Array.isArray(lh?.step)
            ? lh.step
            : null
        if (lh && rawSteps && rawSteps.length > 0) {
          return [
            {
              '@type': 'HowTo',
              '@id': `${reviewUrl}#howto-protect`,
              name: lh.name || `How to Protect Yourself from ${brandData.name}`,
              description: lh.description || `Steps to verify, report, and protect yourself from the ${brandData.name} scam`,
              ...(lh.totalTime ? { totalTime: lh.totalTime } : {}),
              step: rawSteps.map((s, i) => ({
                '@type': 'HowToStep',
                position: i + 1,
                name: s.name,
                text: s.text,
              })),
            },
          ]
        }
        return [
            {
              '@type': 'HowTo',
              '@id': `${reviewUrl}#howto-protect`,
              name: `How to Protect Yourself from ${brandData.name}`,
              description: `Steps to verify, report, and protect yourself from the ${brandData.name} scam`,
              step: [
                {
                  '@type': 'HowToStep',
                  position: 1,
                  name: 'Verify the platform',
                  text: `Check FCA, SEC, and ASIC warning lists for ${brandData.name}. Any legitimate investment platform will be registered with financial regulators.`,
                },
                {
                  '@type': 'HowToStep',
                  position: 2,
                  name: 'Do not deposit money',
                  text: `${brandData.name} shows ${brandData.total_creatives} fraudulent ad creatives across ${brandData.total_geos} countries. Do not send any funds.`,
                },
                {
                  '@type': 'HowToStep',
                  position: 3,
                  name: 'Report the scam',
                  text: 'File reports with IC3.gov (FBI), ReportFraud.ftc.gov (FTC), and your local financial authority. Document all communications and transactions.',
                },
                {
                  '@type': 'HowToStep',
                  position: 4,
                  name: 'Contact your bank',
                  text: 'If you already deposited, contact your bank immediately for a chargeback. Time is critical — most banks have a 60-day dispute window.',
                },
                {
                  '@type': 'HowToStep',
                  position: 5,
                  name: 'Avoid recovery scams',
                  text: 'Any company claiming they can recover your crypto for an upfront fee is a secondary scam targeting people who already lost money.',
                },
              ],
            },
          ]
      })()),

      // ── Dataset Entity (CryptoKiller intelligence) ──
      //
      // THE E-E-A-T UNLOCK. Every other scam-review site ships opinion;
      // CryptoKiller ships first-party data. Eligible for Google Dataset
      // Search indexing when distribution + description + name + creator
      // are present together. Also the target of Article.isBasedOn above,
      // which makes the investigation-to-data edge machine-readable.
      //
      // All fields are populated by sync-shape.js normalizeDataset when
      // the review row has a `dataset` jsonb column. The writer prompt
      // is expected to emit the raw shape; normalizer fills in defaults
      // for license, distribution, keywords.
      ...(dataset ? [{
        '@type': 'Dataset',
        '@id': `${reviewUrl}#cryptokiller-dataset`,
        name: dataset.name,
        description: dataset.description,
        creator: { '@id': `${siteUrl}/#organization` },
        publisher: { '@id': `${siteUrl}/#organization` },
        license: dataset.license,
        datePublished: dataset.datePublished || currentDate,
        ...(dataset.temporalCoverage ? { temporalCoverage: dataset.temporalCoverage } : {}),
        ...(Array.isArray(dataset.variableMeasured) && dataset.variableMeasured.length > 0
          ? { variableMeasured: dataset.variableMeasured }
          : {}),
        ...(Array.isArray(dataset.spatialCoverage) && dataset.spatialCoverage.length > 0
          ? {
              spatialCoverage: dataset.spatialCoverage.map((c) => ({
                '@type': 'Place',
                name: c,
              })),
            }
          : {}),
        ...(Array.isArray(dataset.keywords) && dataset.keywords.length > 0
          ? { keywords: dataset.keywords }
          : {}),
        ...(Array.isArray(dataset.distribution) && dataset.distribution.length > 0
          ? { distribution: dataset.distribution }
          : {}),
        isAccessibleForFree: true,
      }] : []),

      // ── ClaimReview Entities (Google Fact Check rich results) ──
      //
      // Each ClaimReview MUST have itemReviewed.appearance (a URL to
      // where the claim was made) or Google drops it from Fact Check
      // Explorer eligibility. sync-shape.normalizeClaims populates
      // appearance from ad_creative_urls when the writer doesn't supply
      // one explicitly. Claims without an appearance URL are still
      // rendered here as schema (they show up in graph inspection) but
      // without appearance they won't surface in Fact Check. We filter
      // to appearance-present claims to avoid shipping ineligible nodes.
      //
      // datePublished inherits from currentDate (the Article's publish
      // date) rather than generating a render-time `new Date()` — that
      // was the Floventra bug where ClaimReview showed 2026-04-23 while
      // the Article showed 2026-04-22, confusing Google's freshness model.
      ...(Array.isArray(claims)
        ? claims
            .filter((c) => c && c.appearance)
            .map((c, i) => ({
              '@type': 'ClaimReview',
              '@id': `${reviewUrl}#claim-${i + 1}`,
              url: `${reviewUrl}#claim-${i + 1}`,
              datePublished: currentDate,
              author: { '@id': `${siteUrl}/#organization` },
              claimReviewed: c.claimReviewed,
              itemReviewed: {
                '@type': 'Claim',
                appearance: {
                  '@type': 'CreativeWork',
                  url: c.appearance,
                },
                author: {
                  '@type': 'Organization',
                  name: c.originator, // brand name, not editorial voice
                },
              },
              reviewRating: {
                '@type': 'Rating',
                ratingValue: c.ratingValue,
                bestRating: 5,
                worstRating: 1,
                alternateName: c.ratingLabel,
              },
            }))
        : []),

      // ── ItemList Entity (impersonated celebrities / geo targets) ──
      //
      // For celebrity-impersonation scams, the celebrity roster is the
      // single most-queried entity set on the page — AI Overviews cite
      // it constantly. Making it machine-readable via ItemList + nested
      // Person entities converts the roster from "prose list" to "entity
      // graph" for Google and LLM ingestion.
      //
      // Each Person gets bare name + description here; the Replit-side
      // builder expands with sameAs from the 23-entity Wikidata registry
      // when entitySlug is present. For regional figures not in the
      // registry (Kuroda, Hang, Brunet, etc.) the bare Person is correct.
      ...(Array.isArray(itemList) && itemList.length > 0 ? [{
        '@type': 'ItemList',
        '@id': `${reviewUrl}#impersonated-celebrities`,
        name: `Celebrities impersonated in the ${brandData.name} scam campaign`,
        description: `${itemList.length} public figures whose likeness was used without authorisation in ${brandData.name} advertising.`,
        numberOfItems: itemList.length,
        itemListElement: itemList.map((item, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Person',
            name: item.name,
            ...(item.entitySlug ? { identifier: item.entitySlug } : {}),
            ...(item.description ? { description: item.description } : {}),
          },
        })),
      }] : []),

      // ── BreadcrumbList Entity ──
      {
        '@type': 'BreadcrumbList',
        '@id': `${reviewUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
          { '@type': 'ListItem', position: 2, name: 'Investigations', item: `${siteUrl}/scams` },
          { '@type': 'ListItem', position: 3, name: brandData.name, item: reviewUrl },
        ],
      },
    ],
  }
}

module.exports = {
  buildReviewSchema,
  getSiteUrl,
  resolveItemReviewedType,
  resolveReviewRating,
  orgSameAs,
  ENTITY_TYPE_TO_GOOGLE,
}
