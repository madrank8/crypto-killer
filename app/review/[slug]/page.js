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
} from 'lucide-react'

export const revalidate = 60
export const dynamicParams = true

export async function generateStaticParams() {
  try {
    const reviews = await supabaseRequest(
      "/reviews?select=slug&status=eq.published"
    )
    return reviews.map((review) => ({
      slug: review.slug,
    }))
  } catch (error) {
    console.error('Error generating static params:', error)
    return []
  }
}

export async function generateMetadata({ params }) {
  try {
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${params.slug}&select=title,meta_description,slug,scam_score`
    )

    if (!reviews || reviews.length === 0) {
      return {
        title: 'Scam Review Not Found',
        description: 'This scam review could not be found.',
      }
    }

    const review = reviews[0]
    return {
      title: review.title || 'Scam Review - Crypto Killer',
      description: review.meta_description || 'Detailed scam analysis and verdict.',
      openGraph: {
        title: review.title,
        description: review.meta_description,
        type: 'article',
      },
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Scam Review - Crypto Killer',
    }
  }
}

function RiskBadge({ score }) {
  if (score >= 70) {
    return (
      <div className="inline-flex items-center gap-2 bg-red-950/40 border border-red-900/60 px-4 py-2 rounded-full">
        <AlertOctagon size={18} className="text-red-500" />
        <span className="text-red-400 font-bold text-sm">CONFIRMED SCAM</span>
      </div>
    )
  }
  if (score >= 50) {
    return (
      <div className="inline-flex items-center gap-2 bg-amber-950/40 border border-amber-900/60 px-4 py-2 rounded-full">
        <AlertTriangle size={18} className="text-amber-500" />
        <span className="text-amber-400 font-bold text-sm">HIGH RISK</span>
      </div>
    )
  }
  return null
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 flex items-start gap-3">
      <Icon size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="text-white font-bold text-lg mt-1">{value}</p>
      </div>
    </div>
  )
}

export default async function ReviewPage({ params }) {
  try {
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${params.slug}&select=id,title,headline,summary,red_flags,how_it_works,verdict,scam_score,schema_json,brand_id,full_article,faq,methodology,sources,author_name,author_credentials,author_bio,experience_signals,expertise_depth,disclaimer,key_takeaways,not_for_you,protection_steps,trust_indicators,review_date,fact_check_status,word_count,published_at,created_at`
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
        ? (() => { try { const p = JSON.parse(review.red_flags); return Array.isArray(p) ? p : Object.entries(p).map(([k, v]) => ({ flag: k, detail: v })); } catch { return []; } })()
        : typeof review.red_flags === 'object' && review.red_flags
          ? Object.entries(review.red_flags).map(([k, v]) => ({ flag: k, detail: typeof v === 'string' ? v : '' }))
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

        {/* Sticky Navigation */}
        <nav className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-bold text-white hover:text-red-400 transition-colors">
              <Flame size={24} className="text-red-500" />
              <span className="text-lg">CryptoKiller</span>
              <span className="text-xs text-slate-500 ml-1">by SpyOwl</span>
            </Link>
            <div className="flex items-center gap-6">
              <Link href="/" className="text-sm text-slate-400 hover:text-white transition-colors">Home</Link>
              <Link href="/scams" className="text-sm text-slate-400 hover:text-white transition-colors">Investigations</Link>
              <a href="#report" className="text-sm text-slate-400 hover:text-white transition-colors">Report</a>
              <a href="#" className="text-sm text-slate-400 hover:text-white transition-colors">About</a>
              <div className="inline-flex items-center gap-2 bg-red-950/30 border border-red-900/40 px-3 py-1.5 rounded-full text-xs font-semibold text-red-400">
                <AlertOctagon size={14} />
                SCAM ALERT
              </div>
            </div>
          </div>
        </nav>

        {/* Breadcrumb */}
        <div className="bg-slate-900/50 border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Link href="/" className="hover:text-white transition-colors">Home</Link>
              <span className="text-slate-600">/</span>
              <Link href="/scams" className="hover:text-white transition-colors">Investigations</Link>
              <span className="text-slate-600">/</span>
              <span className="text-white">{brand?.name || review.title}</span>
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <div className="bg-gradient-to-b from-slate-900/50 to-slate-950 border-b border-slate-800 py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex flex-wrap items-center gap-4">
              <h1 className="text-5xl md:text-7xl font-black text-white leading-tight">
                {brand?.name || review.title}
              </h1>
              {review.scam_score >= 70 && <RiskBadge score={review.scam_score} />}
            </div>

            {review.headline && (
              <p className="text-xl text-slate-300 max-w-2xl mb-6 leading-relaxed">
                {review.headline}
              </p>
            )}

            {/* Meta Bar */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400 mb-8 pb-8 border-b border-slate-800">
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
                />
                <StatCard
                  icon={Globe}
                  label="Countries Targeted"
                  value={brand.total_geos?.toLocaleString() || '0'}
                />
                <StatCard
                  icon={Clock}
                  label="Days Active"
                  value={daysActive !== null ? daysActive.toLocaleString() : 'N/A'}
                />
                <StatCard
                  icon={AlertOctagon}
                  label="Celebrities Abused"
                  value={brand.total_celebrities?.toLocaleString() || '0'}
                />
              </div>
            )}
          </div>
        </div>

        {/* Key Takeaways */}
        {keyTakeaways.length > 0 && (
          <div className="bg-red-950/20 border-t border-b border-red-900/40 py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                <AlertTriangle size={28} className="text-red-500" />
                Key Takeaways
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {keyTakeaways.map((t, i) => (
                  <div key={i} className="flex gap-3">
                    <X size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-slate-200 text-sm leading-relaxed">
                      {typeof t === 'string' ? t : t.text || ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main Content - Col Span 2 */}
              <div className="lg:col-span-2 space-y-8">
                {/* Investigation Summary */}
                {review.summary && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                      <BookOpen size={24} className="text-amber-500" />
                      Investigation Summary
                    </h2>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      {review.summary.split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* How It Works */}
                {review.how_it_works && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                      <ShieldAlert size={24} className="text-amber-500" />
                      How This Scam Works
                    </h2>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      {review.how_it_works.split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Red Flags */}
                {redFlags.length > 0 && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                      <Flag size={24} className="text-red-500" />
                      Red Flags ({redFlags.length})
                    </h2>
                    <div className="space-y-4">
                      {redFlags.map((rf, i) => (
                        <div
                          key={i}
                          className="bg-slate-950/50 border border-slate-700 rounded-lg p-4 flex gap-3"
                        >
                          <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm text-slate-400 uppercase tracking-wide font-semibold mb-1">
                              Red Flag {i + 1}
                            </p>
                            <h3 className="font-semibold text-white">
                              {rf.flag || (typeof rf === 'string' ? rf : `Warning Sign`)}
                            </h3>
                            {rf.detail && (
                              <p className="text-slate-400 text-sm mt-2 leading-relaxed">{rf.detail}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Protection Steps */}
                {review.protection_steps && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                      <Lock size={24} className="text-green-500" />
                      Protection Steps
                    </h2>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      {review.protection_steps.split('\n').filter(Boolean).map((step, i) => (
                        <div key={i} className="flex gap-3">
                          <CheckCircle size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                          <p>{step}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* FAQ */}
                {faqItems.length > 0 && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                      <FileText size={24} className="text-amber-500" />
                      Frequently Asked Questions
                    </h2>
                    <FaqAccordion items={faqItems} />
                  </div>
                )}

                {/* Methodology */}
                {review.methodology && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                      <Scale size={24} className="text-slate-400" />
                      Methodology
                    </h2>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      {review.methodology.split('\n').filter(Boolean).map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Disclaimer */}
                {review.disclaimer && (
                  <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-6">
                    <p className="text-slate-400 text-sm leading-relaxed">
                      <strong className="text-slate-300">Disclaimer:</strong> {review.disclaimer}
                    </p>
                  </div>
                )}
              </div>

              {/* Sidebar - Col Span 1 */}
              <div className="lg:col-span-1 space-y-6">
                {/* Threat Score Card */}
                <div className="sticky top-24 bg-slate-900/50 border border-slate-800 rounded-lg p-6 space-y-4">
                  <h3 className="text-lg font-bold text-white">Threat Score</h3>
                  <div className="text-center">
                    <div className="text-6xl font-black text-red-500">
                      {review.scam_score || 0}
                    </div>
                    <p className="text-slate-400 text-sm mt-2">/100</p>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 to-red-500 rounded-full"
                      style={{ width: `${Math.min(100, review.scam_score || 0)}%` }}
                    />
                  </div>

                  {/* Risk Level */}
                  <div className="text-center">
                    {review.scam_score >= 70 ? (
                      <span className="inline-block bg-red-950/40 border border-red-900/60 px-3 py-1 rounded-full text-red-400 text-xs font-bold">
                        CRITICAL RISK
                      </span>
                    ) : review.scam_score >= 50 ? (
                      <span className="inline-block bg-amber-950/40 border border-amber-900/60 px-3 py-1 rounded-full text-amber-400 text-xs font-bold">
                        HIGH RISK
                      </span>
                    ) : (
                      <span className="inline-block bg-green-950/40 border border-green-900/60 px-3 py-1 rounded-full text-green-400 text-xs font-bold">
                        LOW RISK
                      </span>
                    )}
                  </div>
                </div>

                {/* Threat Intelligence Table */}
                {brand && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6 space-y-4">
                    <h3 className="text-lg font-bold text-white">Threat Intelligence</h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between items-center pb-3 border-b border-slate-700">
                        <span className="text-slate-400">Ad Creatives</span>
                        <span className="text-white font-semibold">{brand.total_creatives?.toLocaleString() || '0'}</span>
                      </div>
                      <div className="flex justify-between items-center pb-3 border-b border-slate-700">
                        <span className="text-slate-400">Countries</span>
                        <span className="text-white font-semibold">{brand.total_geos?.toLocaleString() || '0'}</span>
                      </div>
                      <div className="flex justify-between items-center pb-3 border-b border-slate-700">
                        <span className="text-slate-400">Celebrities Abused</span>
                        <span className="text-white font-semibold">{brand.total_celebrities?.toLocaleString() || '0'}</span>
                      </div>
                      <div className="flex justify-between items-center pb-3 border-b border-slate-700">
                        <span className="text-slate-400">Campaign Duration</span>
                        <span className="text-white font-semibold">{daysActive !== null ? `${daysActive} days` : 'N/A'}</span>
                      </div>
                      {brand.first_seen_at && (
                        <div className="flex justify-between items-center pb-3 border-b border-slate-700">
                          <span className="text-slate-400">First Detected</span>
                          <span className="text-white font-semibold">
                            {new Date(brand.first_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                      )}
                      {brand.last_seen_at && (
                        <div className="flex justify-between items-center pb-3 border-b border-slate-700">
                          <span className="text-slate-400">Last Active</span>
                          <span className="text-white font-semibold">
                            {new Date(brand.last_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                      )}
                      {brand.status && (
                        <div className="flex justify-between items-center">
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

                {/* Final Verdict Card */}
                {review.verdict && (
                  <div className="bg-red-950/20 border border-red-900/40 rounded-lg p-6">
                    <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                      <AlertOctagon size={20} className="text-red-500" />
                      Final Verdict
                    </h3>
                    <p className="text-slate-200 text-sm leading-relaxed">
                      {review.verdict.split('\n').filter(Boolean).join(' ')}
                    </p>
                  </div>
                )}

                {/* Sources Card */}
                {sources.length > 0 && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <FileText size={20} className="text-slate-400" />
                      Sources
                    </h3>
                    <div className="space-y-3">
                      {sources.map((source, i) => (
                        <a
                          key={i}
                          href={source.url || '#'}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="block text-sm text-slate-300 hover:text-white transition-colors flex items-start gap-2 group"
                        >
                          <ExternalLink size={16} className="text-slate-500 group-hover:text-amber-500 flex-shrink-0 mt-0.5 transition-colors" />
                          <span>{source.name || source.title || 'Reference'}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Related Scams */}
                {relatedScams.length > 0 && (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
                    <h3 className="text-lg font-bold text-white mb-4">Related Scams</h3>
                    <div className="space-y-3">
                      {relatedScams.map((scam) => (
                        <Link
                          key={scam.id}
                          href={`/review/${scam.slug}`}
                          className="block bg-slate-950/50 hover:bg-slate-800/50 border border-slate-700 rounded p-3 transition-colors group"
                        >
                          <h4 className="text-sm font-semibold text-slate-200 group-hover:text-amber-400 transition-colors flex items-center justify-between">
                            {scam.name}
                            <ArrowRight size={16} />
                          </h4>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-slate-500">Scam Score</span>
                            <span
                              className={`text-xs font-bold ${
                                scam.scam_score >= 70
                                  ? 'text-red-400'
                                  : scam.scam_score >= 50
                                    ? 'text-amber-400'
                                    : 'text-green-400'
                              }`}
                            >
                              {scam.scam_score}/100
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
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

        {/* Footer */}
        <footer className="bg-slate-900 border-t border-slate-800 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-4 gap-8 mb-8">
              <div>
                <Link href="/" className="flex items-center gap-2 font-bold text-white hover:text-red-400 transition-colors mb-2">
                  <Flame size={20} className="text-red-500" />
                  CryptoKiller
                </Link>
                <p className="text-slate-400 text-sm">Powered by SpyOwl</p>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-3">Product</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  <li><Link href="/scams" className="hover:text-white transition-colors">Investigations</Link></li>
                  <li><a href="#" className="hover:text-white transition-colors">Browser Extension</a></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-3">Legal</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">Terms</a></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-3">Contact</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  <li><a href="mailto:info@crypto-killer.com" className="hover:text-white transition-colors">Email</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">Twitter</a></li>
                </ul>
              </div>
            </div>
            <div className="border-t border-slate-800 pt-8 flex items-center justify-between text-sm text-slate-500">
              <p>&copy; 2026 CryptoKiller. All rights reserved.</p>
              <p>Ad intelligence powered by SpyOwl</p>
            </div>
          </div>
        </footer>
      </div>
    )
  } catch (error) {
    console.error('Error rendering review:', error)
    notFound()
  }
}
