'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabaseRequest } from '@/lib/supabase'

function ScamScoreGauge({ score }) {
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference
  const angle = (score / 100) * 180 - 90

  // Determine color based on score
  let color = '#10b981' // green
  if (score >= 70) color = '#dc2626' // red
  else if (score >= 50) color = '#f59e0b' // amber
  else if (score >= 30) color = '#eab308' // yellow

  return (
    <div className="flex flex-col items-center">
      <svg width="200" height="140" viewBox="0 0 200 140" className="gauge-svg">
        {/* Background arc */}
        <path
          d="M 20 120 A 90 90 0 0 1 180 120"
          fill="none"
          stroke="#374151"
          strokeWidth="8"
        />
        {/* Progress arc */}
        <path
          d="M 20 120 A 90 90 0 0 1 180 120"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 0.5s ease',
            strokeLinecap: 'round',
          }}
        />
        {/* Center text */}
        <text x="100" y="85" textAnchor="middle" className="text-4xl font-bold" fill={color}>
          {score}
        </text>
        <text x="100" y="105" textAnchor="middle" className="text-xs" fill="#9ca3af">
          SCAM SCORE
        </text>
      </svg>
    </div>
  )
}

export default function Home() {
  const [stats, setStats] = useState({
    totalBrands: 0,
    totalCreatives: 0,
    totalGeos: 0,
  })
  const [latestScams, setLatestScams] = useState([])
  const [trendingUp, setTrendingUp] = useState([])
  const [trendingDown, setTrendingDown] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetch stats and scams on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)

        // Get stats
        const brandsRes = await supabaseRequest('/scam_brands?select=count')
        const creativesRes = await supabaseRequest('/creatives?select=count')

        // Get scam brands with latest activity
        const scamsRes = await supabaseRequest(
          '/scam_brands?select=id,slug,name,scam_score,total_geos,velocity_trend,status&order=last_seen_at.desc&limit=6'
        )

        // Get trending up and down
        const trendingUpRes = await supabaseRequest(
          "/scam_brands?select=id,slug,name,scam_score,velocity_trend&where=velocity_trend.eq.up&order=scam_score.desc&limit=6"
        )
        const trendingDownRes = await supabaseRequest(
          "/scam_brands?select=id,slug,name,scam_score,velocity_trend&where=velocity_trend.eq.down&order=scam_score.desc&limit=6"
        )

        setStats({
          totalBrands: brandsRes.count || 0,
          totalCreatives: creativesRes.count || 0,
          totalGeos: 150, // This would need to be calculated from creatives
        })
        setLatestScams(scamsRes || [])
        setTrendingUp(trendingUpRes || [])
        setTrendingDown(trendingDownRes || [])
        setError(null)
      } catch (err) {
        console.error('Error fetching data:', err)
        setError('Failed to load scam data. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Handle search
  const handleSearch = async (e) => {
    const query = e.target.value
    setSearchQuery(query)

    if (!query.trim()) {
      setSearchResults([])
      return
    }

    try {
      setIsSearching(true)
      const params = new URLSearchParams({
        q: query,
      })
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="bg-dark-bg text-gray-100">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 to-transparent"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h1 className="text-5xl sm:text-6xl font-bold mb-6 text-white leading-tight">
            Stop Crypto Scams{' '}
            <span className="bg-gradient-to-r from-red-500 to-red-600 bg-clip-text text-transparent">
              Before They Start
            </span>
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
            Powered by SpyOwl intelligence. Get detailed analysis of crypto scams, red flags, and
            verdicts from our database of detected fraudulent platforms.
          </p>

          {/* Search Bar */}
          <div className="max-w-2xl mx-auto relative">
            <div className="relative">
              <input
                type="text"
                placeholder="Check if a crypto platform is a scam..."
                value={searchQuery}
                onChange={handleSearch}
                className="search-input w-full"
              />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 btn-primary">
                Search
              </button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-dark-card border border-gray-800 rounded-lg shadow-lg z-10">
                {searchResults.map((result) => (
                  <Link
                    key={result.id}
                    href={`/review/${result.slug}`}
                    className="block px-4 py-3 hover:bg-dark-surface border-b border-gray-800 last:border-b-0 transition-colors"
                  >
                    <div className="font-semibold text-white">{result.name}</div>
                    <div className="text-sm text-gray-400">
                      Scam Score: {result.scam_score || 'N/A'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="stat-card">
            <div className="stat-value">{stats.totalBrands.toLocaleString()}</div>
            <div className="stat-label">Scam Brands Tracked</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.totalCreatives.toLocaleString()}</div>
            <div className="stat-label">Creatives Analyzed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.totalGeos}</div>
            <div className="stat-label">Countries Monitored</div>
          </div>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 mb-8 text-red-200">
            {error}
          </div>
        )}

        {/* Latest Detected Scams */}
        {!loading && (
          <>
            <div>
              <h2 className="section-title">Latest Detected Scams</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {latestScams.map((scam) => (
                  <Link key={scam.id} href={`/review/${scam.slug}`}>
                    <div className="card cursor-pointer group">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-bold text-white group-hover:text-red-400 transition-colors">
                            {scam.name}
                          </h3>
                          <p className="text-xs text-gray-500 mt-1">
                            Status: <span className="badge badge-danger">{scam.status}</span>
                          </p>
                        </div>
                      </div>

                      <div className="mb-4">
                        <ScamScoreGauge score={scam.scam_score || 0} />
                      </div>

                      <div className="flex justify-between text-sm mb-3 pt-4 border-t border-gray-700">
                        <div>
                          <span className="text-gray-400">Locations</span>
                          <p className="text-white font-semibold">{scam.total_geos || 0}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-400">Trend</span>
                          <p className="font-semibold">
                            {scam.velocity_trend === 'up' ? (
                              <span className="text-red-400">↑ Rising</span>
                            ) : scam.velocity_trend === 'down' ? (
                              <span className="text-green-400">↓ Falling</span>
                            ) : (
                              <span className="text-gray-400">→ Stable</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-gray-700">
                        <button className="w-full btn-primary text-sm group-hover:bg-red-700">
                          View Full Analysis
                        </button>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Trending Sections */}
            <div className="mt-16">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Trending Up */}
                <div>
                  <h2 className="text-2xl font-bold mb-6 text-white flex items-center">
                    <span className="text-red-500 mr-2">↑</span> Trending Up
                  </h2>
                  <div className="space-y-3">
                    {trendingUp.map((scam) => (
                      <Link key={scam.id} href={`/review/${scam.slug}`}>
                        <div className="card group cursor-pointer py-3">
                          <div className="flex justify-between items-center">
                            <div>
                              <h4 className="font-semibold text-white group-hover:text-red-400 transition-colors">
                                {scam.name}
                              </h4>
                            </div>
                            <div className="flex items-center space-x-4">
                              <span className="badge badge-danger">
                                {scam.scam_score || 0}/100
                              </span>
                              <span className="text-red-400 font-bold">↑</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Trending Down */}
                <div>
                  <h2 className="text-2xl font-bold mb-6 text-white flex items-center">
                    <span className="text-green-500 mr-2">↓</span> Trending Down
                  </h2>
                  <div className="space-y-3">
                    {trendingDown.map((scam) => (
                      <Link key={scam.id} href={`/review/${scam.slug}`}>
                        <div className="card group cursor-pointer py-3">
                          <div className="flex justify-between items-center">
                            <div>
                              <h4 className="font-semibold text-white group-hover:text-red-400 transition-colors">
                                {scam.name}
                              </h4>
                            </div>
                            <div className="flex items-center space-x-4">
                              <span className="badge badge-warning">
                                {scam.scam_score || 0}/100
                              </span>
                              <span className="text-green-400 font-bold">↓</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading scam data...</p>
          </div>
        )}
      </div>
    </div>
  )
}
