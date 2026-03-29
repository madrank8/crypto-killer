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
    // Fetch review with brand data
    const reviews = await supabaseRequest(
      `/reviews?slug=eq.${params.slug}&select=id,title,headline,summary,red_flags,how_it_works,verdict,scam_score,schema_json,brand_id`
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

    const redFlags = review.red_flags || {}
    const redFlagEntries = Object.entries(redFlags).slice(0, 8)

    // Prepare JSON-LD ClaimReview schema
    const claimReviewSchema = {
      '@context': 'https://schema.org',
      '@type': 'ClaimReview',
      claimReviewed: `${brand?.name || 'This platform'} is a legitimate trading platform`,
      author: {
        '@type': 'Organization',
        name: 'Crypto Killer',
        url: 'https://crypto-killer.com',
      },
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.scam_score || 50,
        bestRating: '100',
        worstRating: '0',
      },
      datePublished: new Date().toISOString(),
      alternativeHeadline: review.headline,
      text: review.summary,
      reviewBody: review.verdict,
    }

    return (
      <div className="bg-dark-bg text-gray-100 min-h-screen">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(claimReviewSchema),
          }}
        />

        {/* Header */}
        <div className="bg-dark-surface border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Link href="/scams" className="text-red-500 hover:text-red-400 text-sm font-semibold mb-4 inline-block">
              ← Back to All Scams
            </Link>
            <h1 className="text-4xl font-bold text-white mb-2">{review.title}</h1>
            {review.headline && (
              <p className="text-xl text-gray-300">{review.headline}</p>
            )}
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
                  <h2 className="text-2xl font-bold text-white mb-4">Overview</h2>
                  <p className="text-gray-300 leading-relaxed">{review.summary}</p>
                </div>
              )}

              {/* Red Flags */}
              {redFlagEntries.length > 0 && (
                <div className="card mb-8">
                  <h2 className="text-2xl font-bold text-white mb-6">Red Flags</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {redFlagEntries.map(([key, value]) => (
                      <div key={key} className="flex items-start space-x-3 p-3 bg-dark-surface rounded border border-gray-800">
                        <span className="text-red-500 text-xl flex-shrink-0">⚠️</span>
                        <div>
                          <h3 className="font-semibold text-white text-sm capitalize">
                            {key.replace(/_/g, ' ')}
                          </h3>
                          {typeof value === 'string' && (
                            <p className="text-gray-400 text-xs mt-1">{value}</p>
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
                    {review.how_it_works.split('\n\n').map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Verdict */}
              {review.verdict && (
                <div className="card border-l-4 border-red-600 mb-8">
                  <h2 className="text-2xl font-bold text-white mb-4">Verdict</h2>
                  <div className="text-gray-300 leading-relaxed space-y-4">
                    {review.verdict.split('\n\n').map((paragraph, idx) => (
                      <p key={idx}>{paragraph}</p>
                    ))}
                  </div>
                  <div className="mt-6 pt-6 border-t border-gray-700">
                    <button className="btn-primary w-full">Report This Scam</button>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              {/* Brand Info */}
              {brand && (
                <div className="card mb-6 sticky top-20">
                  <h3 className="text-lg font-bold text-white mb-4">Brand Information</h3>

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
                        <p className="text-gray-400 text-xs">Locations</p>
                        <p className="text-white font-bold text-lg">{brand.total_geos || 0}</p>
                      </div>
                      <div className="bg-dark-surface p-3 rounded">
                        <p className="text-gray-400 text-xs">Creatives</p>
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
                          {brand.velocity_trend === 'up' ? '↑' : brand.velocity_trend === 'down' ? '↓' : '→'}
                        </p>
                      </div>
                    </div>

                    {brand.first_seen_at && (
                      <div className="bg-dark-surface p-3 rounded text-sm">
                        <p className="text-gray-400">First Seen</p>
                        <p className="text-white mt-1">
                          {new Date(brand.first_seen_at).toLocaleDateString()}
                        </p>
                      </div>
                    )}

                    {brand.last_seen_at && (
                      <div className="bg-dark-surface p-3 rounded text-sm">
                        <p className="text-gray-400">Last Seen</p>
                        <p className="text-white mt-1">
                          {new Date(brand.last_seen_at).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                  </div>
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
