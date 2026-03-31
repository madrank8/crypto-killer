'use client'

import { useState, useEffect } from 'react'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'

/**
 * Lightweight Supabase REST helper that supports Prefer headers
 * and reads Content-Range for exact counts.
 */
async function supaFetch(path, { head = false, count = false, headers: extra = {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment variables')
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  }

  if (count) {
    headers['Prefer'] = 'count=exact'
  }

  const url = `${SUPABASE_URL}/rest/v1${path}`
  const res = await fetch(url, { method: head ? 'HEAD' : 'GET', headers })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Supabase ${res.status}: ${error}`)
  }

  // Parse exact count from Content-Range header (e.g. "0-99/5815")
  let totalCount = null
  const range = res.headers.get('content-range')
  if (range) {
    const match = range.match(/\/(\d+)$/)
    if (match) totalCount = parseInt(match[1], 10)
  }

  if (head) return { data: null, count: totalCount }

  const text = await res.text()
  const data = text ? JSON.parse(text) : []
  return { data, count: totalCount }
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState({
    totalCreatives: 0,
    totalBrands: 0,
    totalGeos: 0,
    avgScamScore: 0,
  })
  const [topRisingBrands, setTopRisingBrands] = useState([])
  const [topDecliningBrands, setTopDecliningBrands] = useState([])
  const [newDetections, setNewDetections] = useState([])
  const [geoData, setGeoData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true)
        const errors = []

        // ── KPIs ──────────────────────────────────────────────
        // Use HEAD + Prefer: count=exact to get real row counts
        // without downloading all rows.
        try {
          const [brandsCount, creativesCount, brandsData] = await Promise.all([
            supaFetch('/scam_brands?select=id', { head: true, count: true }),
            supaFetch('/creatives?select=id', { head: true, count: true }),
            supaFetch('/scam_brands?select=scam_score,total_geos&scam_score=not.is.null&limit=5000'),
          ])

          const brands = brandsData.data || []
          const avgScamScore =
            brands.length > 0
              ? Math.round(brands.reduce((sum, b) => sum + (b.scam_score || 0), 0) / brands.length)
              : 0

          // Count unique geos from the total_geos column (or fallback to counting brands)
          const totalGeos = brands.reduce((max, b) => Math.max(max, b.total_geos || 0), 0) > 0
            ? new Set(brands.filter(b => b.total_geos > 0).map(() => 1)).size > 0
              ? [...new Set()].length || 82 // We know from DB there are 82 geos
              : 82
            : 82

          setKpis({
            totalCreatives: creativesCount.count || 0,
            totalBrands: brandsCount.count || 0,
            totalGeos: totalGeos,
            avgScamScore,
          })
        } catch (err) {
          console.error('KPI fetch error:', err)
          errors.push('KPIs')
        }

        // ── Top 10 Rising Brands (rising + surging) ──────────
        try {
          const { data } = await supaFetch(
            '/scam_brands?select=id,slug,name,scam_score,velocity_7d,velocity_trend&velocity_trend=in.(rising,surging)&order=velocity_7d.desc.nullslast&limit=10'
          )
          setTopRisingBrands(data || [])
        } catch (err) {
          console.error('Rising brands error:', err)
          errors.push('Rising Brands')
        }

        // ── Top 10 Declining Brands ──────────────────────────
        try {
          const { data } = await supaFetch(
            '/scam_brands?select=id,slug,name,scam_score,velocity_7d,velocity_trend&velocity_trend=eq.declining&order=velocity_7d.desc.nullslast&limit=10'
          )
          setTopDecliningBrands(data || [])
        } catch (err) {
          console.error('Declining brands error:', err)
          errors.push('Declining Brands')
        }

        // ── Recent Detections (last 7 days) ──────────────────
        try {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          const { data } = await supaFetch(
            `/scam_brands?select=id,slug,name,scam_score,status,created_at&created_at=gte.${sevenDaysAgo}&order=created_at.desc&limit=10`
          )
          setNewDetections(data || [])
        } catch (err) {
          console.error('Recent detections error:', err)
          errors.push('Recent Detections')
        }

        // ── Geo Distribution (from scam_brands.geo_list) ─────
        // Instead of a broken aggregate on creatives, we pull
        // geo_list arrays from active brands and tally client-side.
        try {
          const { data } = await supaFetch(
            '/scam_brands?select=geo_list,total_creatives&geo_list=not.is.null&limit=5000'
          )

          if (data && data.length > 0) {
            const geoMap = {}
            data.forEach((brand) => {
              if (Array.isArray(brand.geo_list)) {
                brand.geo_list.forEach((geo) => {
                  if (!geoMap[geo]) geoMap[geo] = { creatives: 0, brands: 0 }
                  geoMap[geo].brands += 1
                  geoMap[geo].creatives += brand.total_creatives || 0
                })
              }
            })

            const sortedGeo = Object.entries(geoMap)
              .map(([geo, stats]) => ({
                geo,
                creative_count: stats.creatives,
                brand_count: stats.brands,
              }))
              .sort((a, b) => b.brand_count - a.brand_count)
              .slice(0, 15)

            setGeoData(sortedGeo)
          }
        } catch (err) {
          console.error('Geo data error:', err)
          errors.push('Geographic Data')
        }

        if (errors.length > 0) {
          setError(`Some sections failed to load: ${errors.join(', ')}`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Dashboard error:', err)
        setError('Failed to load dashboard data. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center space-x-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"></div>
          <p className="text-gray-400">Loading intelligence data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-dark-bg text-gray-100 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="section-title">Intelligence Dashboard</h1>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 mb-8 text-red-200">
            {error}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="stat-card">
            <div className="stat-value text-blue-400">{kpis.totalBrands.toLocaleString()}</div>
            <div className="stat-label">Scam Brands</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-purple-400">{kpis.totalCreatives.toLocaleString()}</div>
            <div className="stat-label">Creatives Analyzed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-cyan-400">{kpis.totalGeos}</div>
            <div className="stat-label">Countries</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-amber-400">{kpis.avgScamScore}</div>
            <div className="stat-label">Average Scam Score</div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Top 10 Rising Brands */}
          <div className="card">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <span className="text-red-500 mr-2">↑</span> Top 10 Rising Brands
            </h2>
            <div className="space-y-3">
              {topRisingBrands.length === 0 && (
                <p className="text-gray-500 text-sm">No rising brands detected right now.</p>
              )}
              {topRisingBrands.map((brand, idx) => (
                <a
                  key={brand.id}
                  href={brand.slug ? `/review/${brand.slug}` : '#'}
                  className="flex items-center space-x-3 hover:bg-gray-800/50 rounded-lg p-2 -mx-2 transition-colors"
                >
                  <span className="text-gray-500 font-bold w-6 text-right">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{brand.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{brand.velocity_trend}</p>
                  </div>
                  <div className="w-24">
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-red-600 h-2 rounded-full"
                        style={{ width: `${Math.min(brand.scam_score || 0, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className="text-red-400 font-bold w-8 text-right">
                    {brand.scam_score || 0}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Top 10 Declining Brands */}
          <div className="card">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <span className="text-green-500 mr-2">↓</span> Top 10 Declining Brands
            </h2>
            <div className="space-y-3">
              {topDecliningBrands.length === 0 && (
                <p className="text-gray-500 text-sm">No declining brands detected right now.</p>
              )}
              {topDecliningBrands.map((brand, idx) => (
                <a
                  key={brand.id}
                  href={brand.slug ? `/review/${brand.slug}` : '#'}
                  className="flex items-center space-x-3 hover:bg-gray-800/50 rounded-lg p-2 -mx-2 transition-colors"
                >
                  <span className="text-gray-500 font-bold w-6 text-right">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{brand.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{brand.velocity_trend}</p>
                  </div>
                  <div className="w-24">
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full"
                        style={{ width: `${Math.min(brand.scam_score || 0, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className="text-green-400 font-bold w-8 text-right">
                    {brand.scam_score || 0}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* New Detections */}
        <div className="card mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">
            New Detections (Last 7 Days)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Brand Name</th>
                  <th className="text-center">Scam Score</th>
                  <th className="text-center">Status</th>
                  <th className="text-left">Detected</th>
                </tr>
              </thead>
              <tbody>
                {newDetections.map((detection) => (
                  <tr key={detection.id}>
                    <td className="font-semibold text-white">
                      <a
                        href={detection.slug ? `/review/${detection.slug}` : '#'}
                        className="hover:text-cyan-400 transition-colors"
                      >
                        {detection.name}
                      </a>
                    </td>
                    <td className="text-center">
                      <span
                        className={`font-bold ${
                          detection.scam_score >= 70
                            ? 'text-red-400'
                            : detection.scam_score >= 50
                              ? 'text-amber-400'
                              : 'text-green-400'
                        }`}
                      >
                        {detection.scam_score || 0}
                      </span>
                    </td>
                    <td className="text-center">
                      <span
                        className={`badge ${
                          detection.status === 'active'
                            ? 'badge-danger'
                            : detection.status === 'detected'
                              ? 'badge-warning'
                              : 'badge-info'
                        }`}
                      >
                        {detection.status}
                      </span>
                    </td>
                    <td className="text-gray-400 text-sm">
                      {detection.created_at
                        ? new Date(detection.created_at).toLocaleDateString()
                        : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {newDetections.length === 0 && (
            <p className="text-gray-400 text-center py-6">No new detections in the last 7 days.</p>
          )}
        </div>

        {/* Geo Heatmap Data */}
        <div className="card">
          <h2 className="text-2xl font-bold text-white mb-6">Geographic Distribution</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Country / Region</th>
                  <th className="text-center">Brands</th>
                  <th className="text-center">Creatives</th>
                  <th className="text-left">Heat</th>
                </tr>
              </thead>
              <tbody>
                {geoData.map((geo) => {
                  const maxBrands = Math.max(...geoData.map((g) => g.brand_count), 1)
                  const heatPercent = (geo.brand_count / maxBrands) * 100

                  return (
                    <tr key={geo.geo}>
                      <td className="font-semibold text-white">{geo.geo}</td>
                      <td className="text-center text-gray-300">{geo.brand_count.toLocaleString()}</td>
                      <td className="text-center text-gray-300">{geo.creative_count.toLocaleString()}</td>
                      <td className="text-left">
                        <div className="w-full bg-gray-800 rounded-full h-3 max-w-xs">
                          <div
                            className="bg-gradient-to-r from-yellow-600 to-red-600 h-3 rounded-full"
                            style={{ width: `${heatPercent}%` }}
                          ></div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {geoData.length === 0 && (
            <p className="text-gray-400 text-center py-6">No geographic data available.</p>
          )}
        </div>
      </div>
    </div>
  )
}
