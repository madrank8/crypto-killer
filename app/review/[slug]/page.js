import Link from 'next/link'
import { supabaseRequest } from '@/lib/supabase'
import { notFound } from 'next/navigation'

// Generate static paths for all published reviews
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

// Generate metadata for SEO
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

function ScamScoreGauge({ score }) {
  const radius = 60
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference

  let color = '#10b981'
  if (score >= 70) color = '#dc2626'
  else if (score >= 50) color = '#f59e0b'
  else if (score >= 30) color = '#eab308'

  return (
    <div className="flex flex-col items-center">
      <svg width="280" height="200" viewBox="0 0 280 200" className="gauge-svg">
        <path
          d="M 30 170 A 120 120 0 0 1 250 170"
          fill="none"
          stroke="#374151"
          strokeWidth="12"
        />
        <path
          d="M 30 170 A 120 120 0 0 1 250 170"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 0.5s ease',
            strokeLinecap: 'round',
          }}
        />
        <text x="140" y="110" textAnchor="middle" className="text-5xl font-bold" fill={color}>
          {score}
        </text>
        <text x="140" y="140" textAnchor="middle" className="text-sm" fill="#9ca3af">
          SCAM SCORE
        </text>
      </svg>
    </div>
  )
}

export default async function ReviewPage({ params }) {
  try {
    // Fetch review with brand data + E-E-A-T fields
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${params.slug}&select=id,title,headline,summary,red_flags,how_it_works,verdict,scam_score,schema_json,brand_id,full_article,faq,methodology,sources,author_name,author_credentials,author_bio,experience_signals,expertise_depth,disclaimer,key_takeaways,not_for_you,protection_steps,trust_indicators,review_date,fact_check_status,word_count,published_at,created_at`
    )

    if (!reviews || reviews.length === 0) {
      notFound()
    }

    const review = reviews[0]

    // Fetch associated brand
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

    // Fetch related scams (same trend)
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

    // Parse red_flags — handle both array and object formats
    const redFlags = Array.isArray(review.red_flags)
      ? review.red_flags
      : typeof review.red_flags === 'string'
        ? (() => { try { const p = JSON.parse(review.red_flags); return Array.isArray(p) ? p : Object.entries(p).map(([k, v]) => ({ flag: k, detail: v })); } catch { return []; } })()
        : typeof review.red_flags === 'object' && review.red_flags
          ? Object.entries(review.red_flags).map(([k, v]) => ({ flag: k, detail: typeof v === 'string' ? v : '' }))
          : []

    // Parse FAQ — handle array or string
    const faqItems = Array.isArray(review.faq)
      ? review.faq
      : typeof review.faq === 'string'
        ? (() => { try { const p = JSON.parse(review.faq); return Array.isArray(p) ? p : []; } catch { return []; } })()
        : []

    // Parse sources, key_takeaways, experience_signals
    const safeJsonArray = (val) => {
      if (Array.isArray(val)) return val
      if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
      return []
    }
    const sources = safeJsonArray(review.sources)
    const keyTakeaways = safeJsonArray(review.key_takeaways)
    const experienceSignals = safeJsonArray(review.experience_signals)
    const trustIndicators = typeof review.trust_indicators === 'object' && review.trust_indicators ? review.trust_indicators : {}

    // Use schema_json from database (E-E-A-T enhanced @graph) or fallback
    const schemaJson = review.schema_json || null

    // Publish date
    const publishDate = review.published_at || review.created_at || review.review_date
    const formattedDate = publishDate
      ? new Date(publishDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null

    return (
      <div className="bg-dark-bg text-gray-100 min-h-screen">
        {/* JSON-LD Schema — full E-E-A-T @graph from database */}
        {schemaJson && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(schemaJson),
            }}
          />
        )}

        {/* Header */}
        <div className="bg-dark-surface border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Link href="/scams" className="text-red-500 hover:text-red-400 text-sm font-semibold mb-4 inline-block">
              &larr; Back to All Scams
            </Link>
            <h1 className="text-4xl font-bold text-white mb-2">{review.title}</h1>
            {review.headline && (
              <p className="text-xl text-gray-300">{review.headline}</p>
            )}

            {/* Author Byline — E-E-A-T Experience + Expertise signal */}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-400">
              <span className="text-gray-300 font-medium">
                {review.author_name || 'Crypto Killer Research Team'}
              </span>
              {review.author_credentials && (
                <>
                  <span className="text-gray-600">·</span>
                  <span>{review.author_credentials}</span>
                </>
              )}
              {formattedDate && (
                <>
                  <span className="text-gray-600">·</span>
                  <time dateTime={publishDate}>{formattedDate}</time>
                </>
              )}
              {review.word_count && (
                <>
                  <span className="text-gray-600">·</span>
                  <span>{Math.ceil(review.word_count / 250)} min read</span>
                </>
              )}
              {review.fact_check_status && review.fact_check_status !== 'ai_generated' && (
                <>
                  <span className="text-gray-600">·</span>
                  <span className="text-green-400">Fact-checked</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2">
              {/* Scam Score */}
              <div className="card mb-8">
                <h2 className="text-2xl font-bold text-white mb-6">Scam Score Assessment</h2>
                <ScamScoreGauge score={review.scam_score || 0} />
                <div className="text-center mt-8 pt-6 border-t border-gray-700">
                  <p className="text-gray-400 text-sm mb-2">Risk Level</p>
                  {review.scam_score >= 70 ? (
                    <span className="badge badge-danger text-lg">CRITICAL RISK</span>
                  ) : review.scam_score >= 50 ? (
                    <span className="badge badge-warning text-lg">HIGH RISK</span>
                  ) : review.scam_score >= 30 ? (
                    <span className="badge badge-warning text-lg">MEDIUM RISK</span>
                  ) : (
                    <span className="badge badge-success text-lg">LOW RISK</span>
                  )}
                </div>
              </div>

              {/* Summary */}
              {review.summary && (
                <div className="card mb-8">
                  <h2 className="text-2xl font-bold text-white mb-4">Investigation Summary</h2>
                  <p className="text-gray-300 leading-relaxed">{review.summary}</p>
                </div>
              )}

              {/* Key Takeaways — BLUF for scanners */}
              {keyTakeaways.length > 0 && (
                <div className="card mb-8 border-l-4 border-blue-500">
                  <h2 className="text-2xl font-bold text-white mb-4">Key Takeaways</h2>
                  <ul className="space-y-2">
                    {keyTakeaways.map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-gray-300">
                        <span className="text-blue-400 mt-1 flex-shrink-0">&#x2713;</span>
                        <span>{typeof t === 'string' ? t : t.text || ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Methodology — E-E-A-T Experience signal */}
              {review.methodology && (
                <div className="card mb-8 bg-gray-900/50">
                  <h2 className="text-2xl font-bold text-white mb-4">Our Investigation Methodology</h2>
                  <div className="text-gray-300 leading-relaxed space-y-4">
                    {review.methodology.split('\n').filter(Boolean).map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                  {experienceSignals.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-gray-700">
                      <h3 className="text-lg font-semibold text-white mb-3">Key Investigation Findings</h3>
                      <ul className="space-y-2">
                        {experienceSignals.map((signal, i) => (
                          <li key={i} className="flex items-start gap-2 text-gray-300 text-sm">
                            <span className="text-amber-400 mt-0.5 flex-shrink-0">&#x1F50D;</span>
                            <span>{typeof signal === 'string' ? signal : signal.text || ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Red Flags */}
              {redFlags.length > 0 && (
                <div className="card mb-8">
                  <h2 className="text-2xl font-bold text-white mb-6">Red Flags: {redFlags.length} Warning Signs</h2>
                  <div className="space-y-4">
                    {redFlags.map((rf, i) => (
                      <div key={i} className="flex items-start space-x-3 p-4 bg-dark-surface rounded border border-gray-800">
                        <span className="text-red-500 text-xl flex-shrink-0 mt-0.5">&#x26A0;&#xFE0F;</span>
                        <div>
                          <h3 className="font-semibold text-white">
                            {rf.flag || (typeof rf === 'string' ? rf : `Red Flag ${i + 1}`)}
                          </h3>
                          {rf.detail && (
                            <p className="text-gray-400 text-sm mt-1 leading-relaxed">{rf.detail}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* How It Works */}
              {review.how_it_works && (
                <div className="card mb-8">
                  <h2 className="text-2xl font-bold text-white mb-4">How This Scam Works</h2>
                  <div className="text-gray-300 leading-relaxed space-y-4">
                    {review.how_it_works.split('\n').filter(Boolean).map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Protection Steps */}
              {review.protection_steps && (
                <div className="card mb-8 border-l-4 border-green-600">
                  <h2 className="text-2xl font-bold text-white mb-4">What To Do If You&apos;ve Been Targeted</h2>
                  <div className="text-gray-300 leading-relaxed space-y-4">
                    {review.protection_steps.split('\n').filter(Boolean).map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Not For You — Trust signal */}
              {review.not_for_you && (
                <div className="card mb-8 bg-gray-900/50 border border-gray-700">
                  <h2 className="text-2xl font-bold text-white mb-4">When This Review May Not Apply</h2>
                  <blockquote className="text-gray-300 leading-relaxed border-l-4 border-gray-600 pl-4">
                    {review.not_for_you}
                  </blockquote>
                </div>
              )}

              {/* FAQ — AI Overview extraction target */}
              {faqItems.length > 0 && (
                <div className="card mb-8">
                  <h2 className="text-2xl font-bold text-white mb-6">Frequently Asked Questions</h2>
                  <div className="space-y-6">
                    {faqItems.map((faq, i) => (
                      <div key={i}>
                        <h3 className="text-lg font-semibold text-white mb-2">{faq.question}</h3>
                        <p className="text-gray-300 leading-relaxed">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Verdict */}
              {review.verdict && (
                <div className="card border-l-4 border-red-600 mb-8">
                  <h2 className="text-2xl font-bold text-white mb-4">Final Verdict</h2>
                  <div className="text-gray-300 leading-relaxed space-y-4">
                    {review.verdict.split('\n').filter(Boolean).map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                  <div className="mt-6 pt-6 border-t border-gray-700">
                    <a href="https://www.ic3.gov/" target="_blank" rel="noopener noreferrer" className="btn-primary w-full text-center block">
                      Report This Scam (IC3.gov)
                    </a>
                  </div>
                </div>
              )}

              {/* Sources — Authoritativeness signal */}
              {sources.length > 0 && (
                <div className="card mb-8">
                  <h2 className="text-2xl font-bold text-white mb-4">Sources &amp; References</h2>
                  <ol className="space-y-2 list-decimal list-inside">
                    {sources.map((s, i) => (
                      <li key={i} className="text-gray-300 text-sm">
                        <a href={s.url} target="_blank" rel="nofollow noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                          {s.title}
                        </a>
                        <span className="text-gray-500 ml-1">
                          ({s.type}{s.accessed_date ? `, accessed ${s.accessed_date}` : ''})
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Disclaimer — YMYL Trust signal */}
              {review.disclaimer && (
                <div className="card mb-8 bg-gray-900/30 text-sm">
                  <p className="text-gray-400 leading-relaxed">
                    <strong className="text-gray-300">Disclaimer:</strong> {review.disclaimer}
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              {/* Brand Info */}
              {brand && (
                <div className="card mb-6 sticky top-20">
                  <h3 className="text-lg font-bold text-white mb-4">Threat Intelligence</h3>

                  <div className="space-y-4">
                    <div className="bg-dark-surface p-3 rounded">
                      <p className="text-gray-400 text-xs">Status</p>
                      <p className="text-white font-semibold mt-1">
                        <span
                          className={`badge ${
                            brand.status === 'active'
                              ? 'badge-danger'
                              : brand.status === 'detected'
                                ? 'badge-warning'
                                : 'badge-info'
                          }`}
                        >
                          {brand.status}
                        </span>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-dark-surface p-3 rounded">
                        <p className="text-gray-400 text-xs">Countries</p>
                        <p className="text-white font-bold text-lg">{brand.total_geos || 0}</p>
                      </div>
                      <div className="bg-dark-surface p-3 rounded">
                        <p className="text-gray-400 text-xs">Ad Creatives</p>
                        <p className="text-white font-bold text-lg">{brand.total_creatives || 0}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-dark-surface p-3 rounded">
                        <p className="text-gray-400 text-xs">Celebrities</p>
                        <p className="text-white font-bold text-lg">{brand.total_celebrities || 0}</p>
                      </div>
                      <div className="bg-dark-surface p-3 rounded">
                        <p className="text-gray-400 text-xs">Trend</p>
                        <p className="text-white font-bold text-lg">
                          {brand.velocity_trend === 'up' ? '&#x2191;' : brand.velocity_trend === 'down' ? '&#x2193;' : '&#x2192;'}
                        </p>
                      </div>
                    </div>

                    {brand.first_seen_at && (
                      <div className="bg-dark-surface p-3 rounded text-sm">
                        <p className="text-gray-400">First Detected</p>
                        <p className="text-white mt-1">
                          {new Date(brand.first_seen_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    )}

                    {brand.last_seen_at && (
                      <div className="bg-dark-surface p-3 rounded text-sm">
                        <p className="text-gray-400">Last Active</p>
                        <p className="text-white mt-1">
                          {new Date(brand.last_seen_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Trust Indicators */}
                  {Object.keys(trustIndicators).length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-400 mb-3">Investigation Scope</h4>
                      <div className="space-y-2 text-sm">
                        {trustIndicators.creatives_analyzed && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Creatives Analyzed</span>
                            <span className="text-white font-medium">{trustIndicators.creatives_analyzed}</span>
                          </div>
                        )}
                        {trustIndicators.countries_scanned && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Countries Scanned</span>
                            <span className="text-white font-medium">{trustIndicators.countries_scanned}</span>
                          </div>
                        )}
                        {trustIndicators.investigation_period_days && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Investigation Period</span>
                            <span className="text-white font-medium">{trustIndicators.investigation_period_days} days</span>
                          </div>
                        )}
                        {trustIndicators.data_source && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Data Source</span>
                            <span className="text-white font-medium">{trustIndicators.data_source}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expertise Sidebar — E-E-A-T Expertise signal */}
              {review.expertise_depth && (
                <div className="card mb-6 bg-gray-900/50">
                  <h3 className="text-lg font-bold text-white mb-3">About This Analysis</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">{review.expertise_depth}</p>
                </div>
              )}

              {/* Related Scams */}
              {relatedScams.length > 0 && (
                <div className="card">
                  <h3 className="text-lg font-bold text-white mb-4">Related Scams</h3>
                  <div className="space-y-3">
                    {relatedScams.map((scam) => (
                      <Link key={scam.id} href={`/review/${scam.slug}`}>
                        <div className="bg-dark-surface p-3 rounded hover:bg-dark-card transition-colors cursor-pointer group">
                          <h4 className="text-sm font-semibold text-white group-hover:text-red-400 transition-colors">
                            {scam.name}
                          </h4>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-xs text-gray-400">Score:</span>
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
    )
  } catch (error) {
    console.error('Error rendering review:', error)
    notFound()
  }
}
