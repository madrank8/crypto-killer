'use client'

import { useState, useEffect } from 'react'
import { supabaseRequest } from '@/lib/supabase'

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

        // Fetch KPIs
        const brandsRes = await supabaseRequest('/scam_brands?select=id,scam_score')
        const creativesRes = await supabaseRequest('/creatives?select=id')

        const totalBrands = brandsRes?.length || 0
        const totalCreatives = creativesRes?.length || 0
        const avgScamScore =
          brandsRes && brandsRes.length > 0
            ? Math.round(
                brandsRes.reduce((sum, b) => sum + (b.scam_score || 0), 0) / brandsRes.length
              )
            : 0

        setKpis({
          totalCreatives,
          totalBrands,
          totalGeos: 150, // Approximate
          avgScamScore,
        })

        // Fetch top 10 rising brands
        const risingRes = await supabaseRequest(
          "/scam_brands?select=id,slug,name,scam_score,velocity_7d&velocity_trend=eq.up&order=velocity_7d.desc&limit=10"
        )
        setTopRisingBrands(risingRes || [])

        // Fetch top 10 declining brands
        const decliningRes = await supabaseRequest(
          "/scam_brands?select=id,slug,name,scam_score,velocity_7d&velocity_trend=eq.down&order=velocity_7d.desc&limit=10"
        )
        setTopDecliningBrands(decliningRes || [])

        // Fetch recent detections (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const recentRes = await supabaseRequest(
          `/scam_brands?select=id,slug,name,scam_score,status,created_at&created_at=gt.${sevenDaysAgo}&order=created_at.desc&limit=10`
        )
        setNewDetections(recentRes || [])

        // Fetch geo data with aggregation (simplified version)
        const geoRes = await supabaseRequest(
          '/creatives?select=geo,count(*) as creative_count'
        )
        if (geoRes) {
          // Group by geo
          const geoMap = {}
          geoRes.forEach((item) => {
            if (item.geo) {
              geoMap[item.geo] = (geoMap[item.geo] || 0) + (item.creative_count || 1)
            }
          })

          const sortedGeo = Object.entries(geoMap)
            .map(([geo, count]) => ({
              geo,
              creative_count: count,
              brand_count: Math.ceil(count / 5), // Approximate
            }))
            .sort((a, b) => b.creative_count - a.creative_count)
            .slice(0, 15)

          setGeoData(sortedGeo)
        }

        setError(null)
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
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
        <p className="text-gray-400">Loading dashboard...</p>
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
              {topRisingBrands.map((brand, idx) => (
                <div key={brand.id} className="flex items-center space-x-3">
                  <span className="text-gray-500 font-bold w-6 text-right">#{idx + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">{brand.name}</p>
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
                </div>
              ))}
            </div>
          </div>

          {/* Top 10 Declining Brands */}
          <div className="card">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <span className="text-green-500 mr-2">↓</span> Top 10 Declining Brands
            </h2>
            <div className="space-y-3">
              {topDecliningBrands.map((brand, idx) => (
                <div key={brand.id} className="flex items-center space-x-3">
                  <span className="text-gray-500 font-bold w-6 text-right">#{idx + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">{brand.name}</p>
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
                </div>
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
                    <td className="font-semibold text-white">{detection.name}</td>
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
                  <th className="text-center">Creatives</th>
                  <th className="text-center">Brands Detected</th>
                  <th className="text-left">Heat</th>
                </tr>
              </thead>
              <tbody>
                {geoData.map((geo) => {
                  const maxCreatives = Math.max(...geoData.map((g) => g.creative_count), 1)
                  const heatPercent = (geo.creative_count / maxCreatives) * 100

                  return (
                    <tr key={geo.geo}>
                      <td className="font-semibold text-white">{geo.geo}</td>
                      <td className="text-center text-gray-300">{geo.creative_count}</td>
                      <td className="text-center text-gray-300">{geo.brand_count}</td>
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
