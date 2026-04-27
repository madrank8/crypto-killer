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

// Build-time hardening — if Supabase is unhealthy when Vercel runs `next
// build`, generateStaticParams hangs and `Collecting page data` aborts after
// 60s, then again after 60s, killing the deploy. We saw this on incident
// 2026-04-27 when a runaway scraper PATCH exhausted PostgREST's connection
// pool: production was burning, the fix was committed, but the deploy that
// would have shipped the fix couldn't build because the DB the build needed
// was the DB the build was supposed to heal. To break the loop, we race the
// Supabase call against a hard timeout — if the DB doesn't respond in 8s
// we ship a dynamic-only build (every slug rendered at first request and
// cached via revalidate=60). dynamicParams=true already covers this path.
const STATIC_PARAMS_TIMEOUT_MS = 8000

export async function generateStaticParams() {
  try {
    const reviews = await Promise.race([
      supabaseRequest('/reviews?select=slug&status=eq.published'),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`generateStaticParams timeout after ${STATIC_PARAMS_TIMEOUT_MS}ms`)),
          STATIC_PARAMS_TIMEOUT_MS
        )
      ),
    ])
    return (reviews || []).map((review) => ({ slug: review.slug }))
  } catch (error) {
    // Don't fail the build over this. Empty list + dynamicParams=true means
    // every slug renders on first request instead of being prebuilt.
    console.warn('[review/[slug]] generateStaticParams falling back to dynamic-only:', error.message)
    return []
  }
}

export async function generateMetadata({ params }) {
  try {
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${params.slug}&status=eq.published&select=title,meta_description,slug,scam_score,hero_image_url,hero_image_alt`
    )

    if (!reviews || reviews.length === 0) {
      return {
        title: 'Scam Review Not Found',
        description: 'This scam review could not be found.',
      }
    }

    const review = reviews[0]
    const ogImages = review.hero_image_url
      ? [{ url: review.hero_image_url, alt: review.hero_image_alt || review.title }]
      : []

    return {
      title: review.title || 'Scam Review - Crypto Killer',
      description: review.meta_description || 'Detailed scam analysis and verdict.',
      openGraph: {
        title: review.title,
        description: review.meta_description,
        type: 'article',
        ...(ogImages.length > 0 && { images: ogImages }),
      },
      twitter: {
        card: ogImages.length > 0 ? 'summary_large_image' : 'summary',
        title: review.title,
        description: review.meta_description,
        ...(ogImages.length > 0 && { images: [review.hero_image_url] }),
      },
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
          `/scam_brands?id=eq.${review.brand_id}&select=id,slug,name,total_geos,total_creatives,total_celebrities,velocity_trend,scam_score,status,first_seen_at,last_seen_at`
        )
        if (brands && brands.length > 0) {
          brand = brands[0]
        }
      } catch (err) {
        console.error('Error fetching brand:', err)
      }
    }

    let relatedScams = []
    if (brand) {
      try {
        const related = await supabaseRequest(
          `/scam_brands?velocity_trend=eq.${brand.velocity_trend}&id=neq.${brand.id}&select=id,slug,name,scam_score,status&limit=5`
        )
        relatedScams = related || []
      } catch (err) {
        console.error('Error fetching related scams:', err)
      }
    }

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
