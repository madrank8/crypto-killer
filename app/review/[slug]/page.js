import Link from 'next/link'
import { supabaseRequest } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import FaqAccordion from './FaqAccordion'
import {
  Shield,
  AlertTriangle,
  Flag,
  X,
  CheckCircle,
  Calendar,
  Eye,
  User,
  Clock,
  ShieldAlert,
  Globe,
  Lock,
  Scale,
  BookOpen,
  FileText,
  ExternalLink,
  AlertOctagon,
  ArrowRight,
  Flame,
  TrendingUp,
  TrendingDown,
  ChevronRight,
} from 'lucide-react'

export const revalidate = 60
export const dynamicParams = true

/** ISO-3166 alpha-2 → emoji flag (regional indicator symbols). No assets. */
function flagEmoji(code) {
  const cc = String(code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return '🏳️'
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** ISO-3166 alpha-2 → English country name (server-side Intl, no lookup table). */
function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || code
  } catch {
    return code
  }
}

function truncate(str, max) {
  if (!str || typeof str !== 'string') return ''
  const t = str.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

/** Display label for a review row (brand name preferred). */
function reviewLabel(row, brandNameById) {
  if (row.brand_id && brandNameById[row.brand_id]) return brandNameById[row.brand_id]
  return row.title || row.slug
}

async function fetchBrandNamesForReviews(reviewRows, supabaseRequest) {
  const ids = [...new Set(reviewRows.map((r) => r.brand_id).filter(Boolean))]
  if (ids.length === 0) return {}
  try {
    const list = ids.join(',')
    const brands = await supabaseRequest(`/scam_brands?id=in.(${list})&select=id,name`)
    const map = {}
    for (const b of brands || []) {
      map[b.id] = b.name
    }
    return map
  } catch {
    return {}
  }
}

// Build-time pre-render budget. The page already has `dynamicParams = true`
// and `revalidate = 60`, so any slug NOT in this list still renders fine
// on first visit (ISR) — we just trade a little first-hit latency for
// build reliability.
//
// Why not return all published rows: Vercel's static-page-generation step
// runs `generateMetadata` (another Supabase fetch) per page and hits a
// hard 60s collection-data timeout (default Next.js limit, see
// https://nextjs.org/docs/messages/static-page-generation-timeout).
// On 2026-05-03 a build errored with `Collecting page data for /review/[slug]
// is still timing out after 2 attempts` because the Supabase pool was
// contended (running scraper + a long-running review-generate). Limiting
// to a small "top N" + a hard fetch timeout makes builds resilient to that.
const STATIC_PARAMS_LIMIT = 50
const STATIC_PARAMS_TIMEOUT_MS = 20_000

export async function generateStaticParams() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STATIC_PARAMS_TIMEOUT_MS)
  try {
    const reviews = await supabaseRequest(
      `/reviews?select=slug&status=eq.published&order=published_at.desc.nullslast&limit=${STATIC_PARAMS_LIMIT}`,
      { signal: controller.signal },
    )
    clearTimeout(timer)
    return (Array.isArray(reviews) ? reviews : []).map((review) => ({
      slug: review.slug,
    }))
  } catch (error) {
    clearTimeout(timer)
    // Fall back to zero pre-rendered pages on Supabase slowness or any
    // other failure. dynamicParams = true means everything still works
    // at runtime via on-demand ISR; the build just stops blocking on
    // upstream availability.
    console.error('[generateStaticParams] falling back to [] —', error?.message || error)
    return []
  }
}

// Production canonical lives on cryptokiller.org (Replit). This Vercel
// instance is the admin preview host — canonical and hreflang URLs always
// point at cryptokiller.org regardless of which host renders them.
const PROD_SITE_URL = 'https://cryptokiller.org'

// V1 hreflang URL-segment map. Per-locale slug comes from review_translations.
const LOCALE_TO_URL_SEG = {
  'it':    'it',
  'es':    'es',
  'de':    'de',
  'fr':    'fr',
  'pt-BR': 'pt-br',
}

export async function generateMetadata({ params }) {
  try {
    // Fetch the EN master row first — we need review.id to look up translations
    // by review_id. A parallel by-slug translations query would MISS any
    // translation that overrode its per-locale slug (e.g. master
    // 'polso-crescianza' → IT 'recensione-polso-crescianza'), which is the
    // whole point of the per-locale slug feature. Going by review_id is the
    // only correct path.
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${encodeURIComponent(params.slug)}&status=eq.published&select=id,title,meta_description,slug,scam_score,hero_image_url,hero_image_alt`
    )

    if (!reviews || reviews.length === 0) {
      return {
        title: 'Scam Review Not Found',
        description: 'This scam review could not be found.',
      }
    }

    const review = reviews[0]

    // Pull every published translation of this master. Soft-fail to empty —
    // if Supabase errors here, the metadata still renders, we just lose
    // hreflang annotations on this request.
    const publishedTranslations = await supabaseRequest(
      `/review_translations?review_id=eq.${encodeURIComponent(review.id)}&status=eq.published&select=locale,slug`
    ).catch(() => [])

    const ogImages = review.hero_image_url
      ? [{ url: review.hero_image_url, alt: review.hero_image_alt || review.title }]
      : []

    // Build hreflang languages map. Self-canonical is the EN master URL on
    // cryptokiller.org. Every published translation adds its hreflang entry,
    // and EN doubles as x-default.
    const masterUrl = `${PROD_SITE_URL}/review/${review.slug}`
    const languages = { 'en': masterUrl, 'x-default': masterUrl }
    for (const t of publishedTranslations || []) {
      const seg = LOCALE_TO_URL_SEG[t.locale]
      if (!seg) continue
      languages[t.locale] = `${PROD_SITE_URL}/${seg}/review/${t.slug}`
    }

    const hasTranslations = (publishedTranslations || []).length > 0

    return {
      title: review.title || 'Scam Review - Crypto Killer',
      description: review.meta_description || 'Detailed scam analysis and verdict.',
      alternates: {
        canonical: masterUrl,
        languages,
      },
      openGraph: {
        title: review.title,
        description: review.meta_description,
        type: 'article',
        locale: 'en_US',
        ...(ogImages.length > 0 && { images: ogImages }),
      },
      twitter: {
        card: ogImages.length > 0 ? 'summary_large_image' : 'summary',
        title: review.title,
        description: review.meta_description,
        ...(ogImages.length > 0 && { images: [review.hero_image_url] }),
      },
      // When we have our own manual translations, ask Google NOT to auto-
      // translate the EN page for foreign-language searchers — otherwise
      // Google's Translated Results feature serves a machine-translated EN
      // preview that competes with our real translation. Only emitted when
      // ≥1 translation is live.
      ...(hasTranslations
        ? { other: { googlebot: 'notranslate' } }
        : {}),
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Scam Review - Crypto Killer',
    }
  }
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2.5 border-b border-slate-800 pb-3">
      <span className="text-red-500">{Icon && <Icon size={24} />}</span>
      {children}
    </h2>
  )
}

function RiskBadge({ score }) {
  if (score >= 70) {
    return (
      <div className="inline-flex items-center gap-2 bg-red-600 text-white text-sm px-3 py-1.5 rounded-full uppercase tracking-widest font-bold">
        <ShieldAlert size={16} />
        CONFIRMED SCAM
      </div>
    )
  }
  if (score >= 50) {
    return (
      <div className="inline-flex items-center gap-2 bg-amber-600 text-white text-sm px-3 py-1.5 rounded-full uppercase tracking-widest font-bold">
        <AlertTriangle size={16} />
        HIGH RISK
      </div>
    )
  }
  return null
}

function StatCard({ icon: Icon, label, value, colorClass = 'text-red-500' }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-full bg-slate-900/80 border border-slate-700 flex items-center justify-center ${colorClass}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-white font-bold text-2xl">{value}</p>
    </div>
  )
}

export default async function ReviewPage({ params }) {
  try {
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${params.slug}&status=eq.published&select=id,title,headline,summary,red_flags,how_it_works,verdict,scam_score,schema_json,brand_id,full_article,faq,methodology,sources,author_name,author_credentials,author_bio,experience_signals,expertise_depth,disclaimer,key_takeaways,not_for_you,protection_steps,trust_indicators,review_date,fact_check_status,word_count,published_at,created_at,hero_image_url,hero_image_alt,hero_image_credit,content_images`
    )

    if (!reviews || reviews.length === 0) {
      notFound()
    }

    const review = reviews[0]

    let brand = null
    if (review.brand_id) {
      try {
        const brands = await supabaseRequest(
          `/scam_brands?id=eq.${review.brand_id}&select=id,slug,name,total_geos,total_creatives,total_celebrities,velocity_trend,velocity_7d,geo_breakdown,scam_score,status,first_seen_at,last_seen_at`
        )
        if (brands && brands.length > 0) {
          brand = brands[0]
        }
      } catch (err) {
        console.error('Error fetching brand:', err)
      }
    }

    // ── Geo pressure: top-5 targeted countries for the flags widget ──
    // Mirrors the geo_pressure field shipped to Replit via sync-shape.js so
    // the Vercel preview matches production. Empty → widget hidden.
    const geoPressure = Array.isArray(brand?.geo_breakdown)
      ? brand.geo_breakdown
          .filter((g) => g && typeof g.geo === 'string' && g.geo.trim() && Number.isFinite(Number(g.n)))
          .slice(0, 5)
          .map((g) => ({
            code: g.geo.trim().toUpperCase(),
            ads: Number(g.n),
            share: Number.isFinite(Number(g.share)) ? Number(g.share) : 0,
          }))
      : []
    const geoPressureMax = geoPressure.length > 0 ? geoPressure[0].ads : 0

    // ── Internal-linking flywheel (Task 10) — extra /review + /scams links, no schema change ──
    let recentReviewsRows = []
    try {
      const slugEnc = encodeURIComponent(params.slug)
      recentReviewsRows =
        (await supabaseRequest(
          `/reviews?status=eq.published&slug=neq.${slugEnc}&select=slug,scam_score,verdict,brand_id,title,headline,summary,meta_description,updated_at&order=updated_at.desc&limit=14`
        )) || []
    } catch (err) {
      console.error('Error fetching reviews for internal-link flywheel:', err)
    }

    const currentThreat = review.scam_score ?? 0
    const inThreatBand = recentReviewsRows.filter(
      (r) => Math.abs((r.scam_score ?? 0) - currentThreat) <= 25
    )
    const relatedReviewsFinal =
      inThreatBand.length >= 4
        ? inThreatBand.slice(0, 4)
        : [
            ...inThreatBand,
            ...recentReviewsRows.filter((r) => !inThreatBand.some((b) => b.slug === r.slug)),
          ].slice(0, 4)

    const relatedSlugs = new Set(relatedReviewsFinal.map((r) => r.slug))
    const recentReviewsFinal = recentReviewsRows.filter((r) => !relatedSlugs.has(r.slug)).slice(0, 5)

    const usedForLearn = new Set([...relatedReviewsFinal, ...recentReviewsFinal].map((r) => r.slug))
    const learnMoreRows = recentReviewsRows.filter((r) => !usedForLearn.has(r.slug)).slice(0, 3)

    const flywheelReviewRows = [...relatedReviewsFinal, ...recentReviewsFinal, ...learnMoreRows]
    const brandNameById = await fetchBrandNamesForReviews(flywheelReviewRows, supabaseRequest)

    const showAuthorCard = Boolean(review.author_name?.trim() || review.author_bio?.trim())

    const redFlags = Array.isArray(review.red_flags)
      ? review.red_flags
      : typeof review.red_flags === 'string'
        ? (() => { try { const p = JSON.parse(review.red_flags); return Array.isArray(p) ? p : Object.entries(p).map(([k, v]) => ({ flag: k, detail: v, emoji: undefined })); } catch { return []; } })()
        : typeof review.red_flags === 'object' && review.red_flags
          ? Object.entries(review.red_flags).map(([k, v]) => ({ flag: k, detail: typeof v === 'string' ? v : '', emoji: undefined }))
          : []

    const faqItems = Array.isArray(review.faq)
      ? review.faq
      : typeof review.faq === 'string'
        ? (() => { try { const p = JSON.parse(review.faq); return Array.isArray(p) ? p : []; } catch { return []; } })()
        : []

    const safeJsonArray = (val) => {
      if (Array.isArray(val)) return val
      if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
      return []
    }

    const sources = safeJsonArray(review.sources)
    const keyTakeaways = safeJsonArray(review.key_takeaways)
    const experienceSignals = safeJsonArray(review.experience_signals)
    const trustIndicators = typeof review.trust_indicators === 'object' && review.trust_indicators ? review.trust_indicators : {}

    const schemaJson = review.schema_json || null
    const publishDate = review.published_at || review.created_at || review.review_date
    const formattedDate = publishDate
      ? new Date(publishDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null

    const daysActive = brand && brand.first_seen_at && brand.last_seen_at
      ? Math.ceil((new Date(brand.last_seen_at) - new Date(brand.first_seen_at)) / 86400000)
      : null

    // Red flag emojis to cycle through
    const redFlagEmojis = ['🎭', '📢', '🔒', '⚖️', '⏰', '👤', '📞', '🌍']

    return (
      <div className="bg-slate-950 text-slate-300 min-h-screen">
        {/* JSON-LD Schema */}
        {schemaJson && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(schemaJson),
            }}
          />
        )}

        {/* Breadcrumb */}
        <div className="bg-slate-900/30 border-b border-slate-800/50">
          <div className="max-w-6xl mx-auto container px-4 py-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Link href="/" className="text-slate-400 hover:text-white transition-colors">Home</Link>
              <ChevronRight size={16} className="text-slate-600" />
              <Link href="/scams" className="text-slate-400 hover:text-white transition-colors">Investigations</Link>
              <ChevronRight size={16} className="text-slate-600" />
              <span className="text-white font-medium">{brand?.name || review.title}</span>
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <div className="bg-slate-950 border-b border-slate-800/50 py-16">
          <div className="max-w-6xl mx-auto container px-4">
            <div className="mb-8">
              <div className="flex flex-wrap items-center gap-4 mb-6">
                <h1 className="text-5xl md:text-7xl font-black text-white leading-tight">
                  {brand?.name || review.title}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <RiskBadge score={review.scam_score} />
              </div>
            </div>

            {review.headline && (
              <p className="text-xl text-slate-300 max-w-3xl mb-8 leading-relaxed">
                {review.headline}
              </p>
            )}

            {/* Hero Image */}
            {review.hero_image_url && (
              <div className="mb-10 rounded-2xl overflow-hidden border border-slate-800">
                <img
                  src={review.hero_image_url}
                  alt={review.hero_image_alt || `${brand?.name || 'Scam'} investigation`}
                  className="w-full h-auto max-h-[480px] object-cover"
                  loading="eager"
                />
                {review.hero_image_credit && (
                  <div className="bg-slate-900/80 px-4 py-2 text-xs text-slate-500">
                    Photo: {review.hero_image_credit}
                  </div>
                )}
              </div>
            )}

            {/* Meta Bar */}
            <div className="flex flex-wrap items-center gap-6 text-sm text-slate-400 mb-10 pb-8 border-b border-slate-800/50">
              {formattedDate && (
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-slate-500" />
                  <time dateTime={publishDate}>{formattedDate}</time>
                </div>
              )}
              {review.word_count && (
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-slate-500" />
                  <span>{Math.ceil(review.word_count / 250)} min read</span>
                </div>
              )}
              {review.author_name && (
                <div className="flex items-center gap-2">
                  <User size={16} className="text-slate-500" />
                  <span>{review.author_name}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-slate-500" />
                <span>SpyOwl Ad Surveillance</span>
              </div>
            </div>

            {/* Stats Grid */}
            {brand && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  icon={Flame}
                  label="Ad Creatives"
                  value={brand.total_creatives?.toLocaleString() || '0'}
                  colorClass="text-red-500"
                />
                <StatCard
                  icon={Globe}
                  label="Countries Targeted"
                  value={brand.total_geos?.toLocaleString() || '0'}
                  colorClass="text-amber-500"
                />
                <StatCard
                  icon={TrendingUp}
                  label="Days Active"
                  value={daysActive !== null ? daysActive.toLocaleString() : 'N/A'}
                  colorClass="text-orange-500"
                />
                <StatCard
                  icon={AlertTriangle}
                  label="Celebrities Abused"
                  value={brand.total_celebrities?.toLocaleString() || '0'}
                  colorClass="text-blue-500"
                />
              </div>
            )}

            {/* Ad velocity + heaviest-hit countries (flags widget, 2026-07-08).
               Mirrors the production Replit card so the preview is faithful.
               Hidden entirely when the brand has no geo_breakdown. */}
            {brand && geoPressure.length > 0 && (
              <div className="mt-4 bg-slate-950/60 border border-slate-800 rounded-2xl px-6 py-5 flex flex-wrap items-center gap-6">
                <div className="min-w-[180px]">
                  <div className="flex items-center gap-2 mb-2.5">
                    <TrendingUp size={15} className="text-amber-500" />
                    <span className="text-[11px] tracking-[0.12em] font-medium text-slate-400">AD VELOCITY</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    <span className="text-2xl font-medium text-slate-50">{(brand.velocity_7d ?? 0).toLocaleString()}</span>
                    <span className="text-[13px] text-slate-400">new ads this week</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {brand.name} ad campaign activity in the last 7 days
                  </p>
                </div>

                <div className="flex-1 min-w-[280px]">
                  <div className="flex items-center gap-2 mb-2.5">
                    <Globe size={14} className="text-red-400" />
                    <span className="text-[11px] tracking-[0.12em] font-medium text-slate-400">HEAVIEST-HIT COUNTRIES</span>
                    {brand.total_creatives > 0 && (
                      <span className="text-[11px] text-slate-500">· share of {brand.total_creatives.toLocaleString()} scraped ads</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {geoPressure.map((g, i) => (
                      <div
                        key={g.code}
                        title={`${countryName(g.code)}: ${g.ads} scam ad creatives (${Math.round(g.share * 100)}% of all ads scraped for ${brand.name})`}
                        className={`rounded-xl px-3 py-2 min-w-[76px] border ${
                          i === 0
                            ? 'bg-amber-500/10 border-amber-500/40'
                            : 'bg-slate-900/50 border-slate-800'
                        }`}
                      >
                        <div className="text-xl leading-none" aria-hidden="true">{flagEmoji(g.code)}</div>
                        <div className={`text-xs font-medium mt-1.5 ${i === 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                          {countryName(g.code)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {g.ads.toLocaleString()} ads · {Math.round(g.share * 100)}%
                        </div>
                        <div className="h-[3px] bg-slate-800 rounded-sm mt-1.5">
                          <div
                            className={`h-[3px] rounded-sm ${i === 0 ? 'bg-amber-500' : 'bg-red-400'}`}
                            style={{ width: `${geoPressureMax > 0 ? Math.max(8, Math.round((g.ads / geoPressureMax) * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {brand.velocity_trend && (
                  <div className="self-start">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border ${
                      brand.velocity_trend === 'surging' || brand.velocity_trend === 'rising'
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                        : brand.velocity_trend === 'declining' || brand.velocity_trend === 'dead'
                          ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                          : 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                    }`}>
                      {brand.velocity_trend === 'declining' || brand.velocity_trend === 'dead'
                        ? <TrendingDown size={14} />
                        : <TrendingUp size={14} />}
                      {brand.velocity_trend.charAt(0).toUpperCase() + brand.velocity_trend.slice(1)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Key Takeaways */}
        {keyTakeaways.length > 0 && (
          <div className="bg-red-950/20 border-b border-red-900/40 py-10">
            <div className="max-w-6xl mx-auto container px-4">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2.5 border-b border-red-900/40 pb-3">
                <span className="text-red-500"><AlertOctagon size={24} /></span>
                Key Takeaways
              </h2>
              <ul className="space-y-3">
                {keyTakeaways.map((t, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <X size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-slate-200 text-sm leading-relaxed">
                      {typeof t === 'string' ? t : t.text || ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="py-16">
          <div className="max-w-6xl mx-auto container px-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main Content - Col Span 2 */}
              <div className="lg:col-span-2 space-y-10">
                {/* Content Images Gallery (from Unsplash pipeline) */}
                {Array.isArray(review.content_images) && review.content_images.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
                    {review.content_images.map((img, i) => (
                      <figure key={i} className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40">
                        <img
                          src={img.url}
                          alt={img.alt || `Evidence image ${i + 1}`}
                          className="w-full h-48 object-cover"
                          loading="lazy"
                        />
                        {img.credit && (
                          <figcaption className="px-3 py-1.5 text-xs text-slate-500">
                            Photo: {img.credit}
                          </figcaption>
                        )}
                      </figure>
                    ))}
                  </div>
                )}

                {/* Full Article (with embedded visuals) — takes priority if available */}
                {review.full_article && review.full_article.includes('ck-visual') ? (
                  <div>
                    <SectionTitle icon={FileText}>Investigation Report</SectionTitle>
                    <div
                      className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed
                        [&_figure]:my-6 [&_figure]:text-center
                        [&_figcaption]:text-slate-400 [&_figcaption]:text-sm [&_figcaption]:mt-2
                        [&_img]:rounded-xl [&_img]:border [&_img]:border-slate-800 [&_img]:mx-auto
                        [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-4
                        [&_p]:mb-4 [&_p]:text-slate-300"
                      dangerouslySetInnerHTML={{ __html: review.full_article }}
                    />
                  </div>
                ) : (
                  <>
                {/* Investigation Summary */}
                {review.summary && (
                  <div>
                    <SectionTitle icon={FileText}>Investigation Summary</SectionTitle>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      {review.summary.split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                    <div className="mt-6 bg-slate-900 border border-red-900/50 rounded-lg p-4">
                      <p className="text-slate-400 text-sm leading-relaxed">
                        <span className="text-red-400 font-semibold">Warning:</span> This analysis is for informational purposes only and should not be considered financial advice.
                      </p>
                    </div>
                  </div>
                )}

                {/* How It Works */}
                {review.how_it_works && (
                  <div>
                    <SectionTitle icon={ShieldAlert}>How This Scam Works</SectionTitle>
                    <p className="text-slate-300 mb-4 leading-relaxed">
                      Understanding the mechanics of this scam can help you recognize similar patterns:
                    </p>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      {review.how_it_works.split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Red Flags */}
                {redFlags.length > 0 && (
                  <div>
                    <SectionTitle icon={Flag}>Red Flags</SectionTitle>
                    <div className="space-y-4">
                      {redFlags.map((rf, i) => (
                        <div
                          key={i}
                          className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden"
                        >
                          <div className="p-5 flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-red-950/60 border border-red-900/60 flex items-center justify-center flex-shrink-0">
                              <span className="text-lg">{redFlagEmojis[i % redFlagEmojis.length]}</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-red-400 text-xs uppercase font-bold tracking-wide mb-2">
                                RED FLAG {i + 1}
                              </p>
                              <h3 className="font-bold text-white mb-2">
                                {rf.flag || (typeof rf === 'string' ? rf : `Warning Sign`)}
                              </h3>
                              {rf.detail && (
                                <p className="text-slate-400 text-sm leading-relaxed">{rf.detail}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* What To Do If You've Been Scammed */}
                {review.protection_steps && (
                  <div>
                    <SectionTitle icon={CheckCircle}>What To Do If You've Been Scammed</SectionTitle>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {review.protection_steps.split('\n').filter(Boolean).map((step, i) => (
                        <div key={i} className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <CheckCircle size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                            <p className="text-slate-300 text-sm">{step}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* FAQ */}
                {faqItems.length > 0 && (
                  <div>
                    <SectionTitle icon={BookOpen}>Frequently Asked Questions</SectionTitle>
                    <FaqAccordion items={faqItems} />
                  </div>
                )}

                {/* Methodology */}
                {review.methodology && (
                  <div>
                    <SectionTitle icon={Eye}>Research Methodology</SectionTitle>
                    <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
                      {review.methodology.split('\n\n').filter(Boolean).map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </div>
                )}
                  </>
                )}
              </div>

              {/* Sidebar - Col Span 1 */}
              <div className="lg:col-span-1">
                <div className="space-y-6 lg:sticky lg:top-20">
                  {/* Threat Score Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide">Threat Score</h3>
                    <div className="text-center py-4">
                      <div className={`text-6xl font-black ${
                        review.scam_score >= 70 ? 'text-red-500' : review.scam_score >= 50 ? 'text-amber-500' : 'text-green-500'
                      }`}>
                        {review.scam_score || 0}
                      </div>
                      <p className="text-slate-400 text-sm mt-2">/ 100</p>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          review.scam_score >= 70 ? 'bg-red-600' : review.scam_score >= 50 ? 'bg-amber-600' : 'bg-green-600'
                        }`}
                        style={{ width: `${Math.min(100, review.scam_score || 0)}%` }}
                      />
                    </div>

                    {/* Risk Level */}
                    <div className="text-center pt-2">
                      {review.scam_score >= 70 ? (
                        <span className="text-red-400 text-sm font-bold">
                          Extreme Risk — Do Not Deposit
                        </span>
                      ) : review.scam_score >= 50 ? (
                        <span className="text-amber-400 text-sm font-bold">
                          High Risk — Exercise Caution
                        </span>
                      ) : (
                        <span className="text-green-400 text-sm font-bold">
                          Lower Risk
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Threat Intelligence Table */}
                  {brand && (
                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide">Threat Intelligence</h3>
                      <div className="space-y-4 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Ad Creatives</span>
                          <span className="text-white font-semibold">{brand.total_creatives?.toLocaleString() || '0'}</span>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                          <span className="text-slate-400">Countries</span>
                          <span className="text-white font-semibold">{brand.total_geos?.toLocaleString() || '0'}</span>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                          <span className="text-slate-400">Celebrities Abused</span>
                          <span className="text-white font-semibold">{brand.total_celebrities?.toLocaleString() || '0'}</span>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                          <span className="text-slate-400">Campaign Duration</span>
                          <span className="text-white font-semibold">{daysActive !== null ? `${daysActive} days` : 'N/A'}</span>
                        </div>
                        {brand.first_seen_at && (
                          <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                            <span className="text-slate-400">First Detected</span>
                            <span className="text-white font-semibold text-xs">
                              {new Date(brand.first_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </div>
                        )}
                        {brand.last_seen_at && (
                          <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                            <span className="text-slate-400">Last Active</span>
                            <span className="text-white font-semibold text-xs">
                              {new Date(brand.last_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </div>
                        )}
                        {brand.status && (
                          <div className="flex justify-between items-center border-t border-slate-800 pt-4">
                            <span className="text-slate-400">Status</span>
                            <div className="flex items-center gap-2">
                              {brand.status === 'active' && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                              <span className="text-white font-semibold capitalize">{brand.status}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Regulatory Status */}
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide">Regulatory Status</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {['FCA', 'SEC', 'ASIC', 'CySEC'].map((reg) => (
                        <div key={reg} className="bg-red-950/30 border border-red-900/40 rounded px-2 py-1.5 text-center">
                          <p className="text-xs text-slate-400 font-semibold">{reg}</p>
                          <div className="flex justify-center mt-1">
                            <X size={16} className="text-red-500" />
                          </div>
                          <p className="text-xs text-slate-500 mt-1">None</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Final Verdict Card */}
                  {review.verdict && (
                    <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-5">
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                        <AlertOctagon size={18} className="text-red-500" />
                        Final Verdict
                      </h3>
                      <p className="text-slate-200 text-sm leading-relaxed mb-3">
                        <span className="font-semibold">{brand?.name || 'This operation'} is a confirmed crypto scam.</span>
                      </p>
                      <p className="text-red-400 text-sm font-semibold">Do not deposit any money.</p>
                    </div>
                  )}

                  {/* Sources Card */}
                  {sources.length > 0 && (
                    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-4">Sources</h3>
                      <div className="space-y-3">
                        {sources.map((source, i) => (
                          <a
                            key={i}
                            href={source.url || '#'}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            className="text-sm text-slate-300 hover:text-white transition-colors flex items-start gap-2 group"
                          >
                            <ExternalLink size={14} className="text-slate-500 group-hover:text-amber-500 flex-shrink-0 mt-0.5 transition-colors" />
                            <span className="leading-snug">{source.name || source.title || 'Reference'}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Internal-linking flywheel (Task 10): author + related + learn-more + recent */}
            <div className="mt-14 pt-10 border-t border-slate-800 space-y-10">
              {showAuthorCard && (
                <aside
                  className="author-card rounded-xl border border-slate-800 bg-slate-900/50 p-6"
                  aria-labelledby="author-card-heading"
                >
                  <h2 id="author-card-heading" className="text-xl font-bold text-white mb-3">
                    About the author
                  </h2>
                  <p className="text-slate-200">
                    <strong>{review.author_name || 'Crypto Killer Research'}</strong>
                    {review.author_credentials ? (
                      <span className="text-slate-400"> — {review.author_credentials}</span>
                    ) : null}
                  </p>
                  {review.author_bio ? (
                    <p className="text-slate-400 text-sm leading-relaxed mt-3">{truncate(review.author_bio, 320)}</p>
                  ) : null}
                  <p className="mt-4">
                    <Link
                      href="/scams"
                      className="text-red-400 hover:text-red-300 text-sm font-semibold inline-flex items-center gap-1"
                    >
                      More investigations
                      <ArrowRight size={16} />
                    </Link>
                  </p>
                </aside>
              )}

              {relatedReviewsFinal.length > 0 && (
                <section aria-labelledby="related-investigations-heading">
                  <h2
                    id="related-investigations-heading"
                    className="text-2xl font-bold text-white mb-4 flex items-center gap-2.5 border-b border-slate-800 pb-3"
                  >
                    <span className="text-red-500">
                      <Shield size={24} />
                    </span>
                    Related investigations
                  </h2>
                  <ul className="space-y-3 text-slate-300">
                    {relatedReviewsFinal.map((r) => (
                      <li key={r.slug}>
                        <Link href={`/review/${r.slug}`} className="text-white font-medium hover:text-red-400">
                          {reviewLabel(r, brandNameById)}
                        </Link>
                        <span className="text-slate-500">
                          {' '}
                          — Threat {(r.scam_score ?? 0)}/100. {truncate(r.verdict || 'Investigation in progress.', 160)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {learnMoreRows.length > 0 && (
                <section aria-labelledby="learn-more-heading">
                  <h2
                    id="learn-more-heading"
                    className="text-2xl font-bold text-white mb-4 flex items-center gap-2.5 border-b border-slate-800 pb-3"
                  >
                    <span className="text-red-500">
                      <BookOpen size={24} />
                    </span>
                    Learn more about crypto scams
                  </h2>
                  <ul className="space-y-3 text-slate-300">
                    {learnMoreRows.map((b) => (
                      <li key={b.slug}>
                        <Link href={`/review/${b.slug}`} className="text-white font-medium hover:text-red-400">
                          {b.headline || b.title || b.slug}
                        </Link>
                        <span className="text-slate-500">
                          {' '}
                          — {truncate(b.meta_description || b.summary || '', 180)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {recentReviewsFinal.length > 0 && (
                <section aria-labelledby="recently-published-heading">
                  <h2
                    id="recently-published-heading"
                    className="text-2xl font-bold text-white mb-4 flex items-center gap-2.5 border-b border-slate-800 pb-3"
                  >
                    <span className="text-red-500">
                      <FileText size={24} />
                    </span>
                    Recently published investigations
                  </h2>
                  <ul className="space-y-2 text-slate-300">
                    {recentReviewsFinal.map((r) => (
                      <li key={r.slug}>
                        <Link href={`/review/${r.slug}`} className="text-white font-medium hover:text-red-400">
                          {reviewLabel(r, brandNameById)}
                        </Link>
                        <span className="text-slate-500"> — Threat {(r.scam_score ?? 0)}/100</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gradient-to-r from-red-950/40 to-red-900/30 border-y border-red-900/60 py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Were You Targeted by {brand?.name || 'This Scam'}?
            </h2>
            <p className="text-slate-300 mb-6 max-w-xl mx-auto">
              If you've been affected by this scam, report it to authorities and seek help from fraud recovery specialists.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://www.ic3.gov/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                <AlertOctagon size={18} />
                Report to IC3
              </a>
              <a
                href="#"
                className="inline-flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                <FileText size={18} />
                Recovery Guide
              </a>
            </div>
          </div>
        </div>

      </div>
    )
  } catch (error) {
    console.error('Error rendering review:', error)
    notFound()
  }
}
