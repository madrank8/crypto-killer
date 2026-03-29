'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabaseRequest } from '@/lib/supabase'

export default function ScamsPage() {
  const [scams, setScams] = useState([])
  const [filteredScams, setFilteredScams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters and sorting
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('scam_score')
  const [sortOrder, setSortOrder] = useState('desc')
  const [statusFilter, setStatusFilter] = useState('all')
  const [trendFilter, setTrendFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20

  // Fetch scams
  useEffect(() => {
    const fetchScams = async () => {
      try {
        setLoading(true)
        const res = await supabaseRequest(
          '/scam_brands?select=id,slug,name,scam_score,total_geos,total_creatives,velocity_trend,status,first_seen_at,last_seen_at'
        )
        setScams(res || [])
        setError(null)
      } catch (err) {
        console.error('Error fetching scams:', err)
        setError('Failed to load scams. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchScams()
  }, [])

  // Filter and sort
  useEffect(() => {
    let filtered = scams

    // Apply search
    if (searchTerm) {
      filtered = filtered.filter((scam) =>
        scam.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((scam) => scam.status === statusFilter)
    }

    // Apply trend filter
    if (trendFilter !== 'all') {
      filtered = filtered.filter((scam) => scam.velocity_trend === trendFilter)
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal = a[sortBy]
      let bVal = b[sortBy]

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })

    setFilteredScams(filtered)
    setCurrentPage(1)
  }, [scams, searchTerm, sortBy, sortOrder, statusFilter, trendFilter])

  // Pagination
  const totalPages = Math.ceil(filteredScams.length / itemsPerPage)
  const startIdx = (currentPage - 1) * itemsPerPage
  const endIdx = startIdx + itemsPerPage
  const paginatedScams = filteredScams.slice(startIdx, endIdx)

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-gray-400">Loading scams...</p>
      </div>
    )
  }

  return (
    <div className="bg-dark-bg text-gray-100 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="section-title">Browse All Crypto Scams</h1>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 mb-8 text-red-200">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="card mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Search</label>
              <input
                type="text"
                placeholder="Search brands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input w-full text-sm"
              />
            </div>

            {/* Sort by */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 bg-dark-surface border border-gray-800 rounded text-sm text-white focus:border-red-500 focus:outline-none"
              >
                <option value="scam_score">Scam Score</option>
                <option value="total_creatives">Creatives</option>
                <option value="total_geos">Locations</option>
                <option value="name">Name</option>
              </select>
            </div>

            {/* Order */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Order</label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-full px-3 py-2 bg-dark-surface border border-gray-800 rounded text-sm text-white focus:border-red-500 focus:outline-none"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 bg-dark-surface border border-gray-800 rounded text-sm text-white focus:border-red-500 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="detected">Detected</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {/* Trend */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Trend</label>
              <select
                value={trendFilter}
                onChange={(e) => setTrendFilter(e.target.value)}
                className="w-full px-3 py-2 bg-dark-surface border border-gray-800 rounded text-sm text-white focus:border-red-500 focus:outline-none"
              >
                <option value="all">All Trends</option>
                <option value="up">Trending Up</option>
                <option value="down">Trending Down</option>
                <option value="stable">Stable</option>
              </select>
            </div>
          </div>

          <div className="text-sm text-gray-400 mt-4">
            Showing {filteredScams.length} scams
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Brand Name</th>
                <th className="text-center">Scam Score</th>
                <th className="text-center">Locations</th>
                <th className="text-center">Creatives</th>
                <th className="text-center">Trend</th>
                <th className="text-center">Status</th>
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedScams.map((scam) => (
                <tr key={scam.id}>
                  <td className="font-semibold text-white">{scam.name}</td>
                  <td className="text-center">
                    <span
                      className={`font-bold ${
                        scam.scam_score >= 70
                          ? 'text-red-400'
                          : scam.scam_score >= 50
                            ? 'text-amber-400'
                            : 'text-green-400'
                      }`}
                    >
                      {scam.scam_score || 0}
                    </span>
                  </td>
                  <td className="text-center text-gray-300">{scam.total_geos || 0}</td>
                  <td className="text-center text-gray-300">{scam.total_creatives || 0}</td>
                  <td className="text-center">
                    {scam.velocity_trend === 'up' ? (
                      <span className="text-red-400 font-bold">↑</span>
                    ) : scam.velocity_trend === 'down' ? (
                      <span className="text-green-400 font-bold">↓</span>
                    ) : (
                      <span className="text-gray-400">→</span>
                    )}
                  </td>
                  <td className="text-center">
                    <span
                      className={`badge ${
                        scam.status === 'active'
                          ? 'badge-danger'
                          : scam.status === 'detected'
                            ? 'badge-warning'
                            : 'badge-info'
                      }`}
                    >
                      {scam.status}
                    </span>
                  </td>
                  <td className="text-center">
                    <Link href={`/review/${scam.slug}`} className="text-red-500 hover:text-red-400">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {paginatedScams.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">No scams found matching your filters.</p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center space-x-2 mt-8">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-dark-surface border border-gray-800 rounded text-sm text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:border-gray-700"
            >
              Previous
            </button>

            <div className="flex space-x-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-2 rounded text-sm ${
                      currentPage === pageNum
                        ? 'bg-red-600 text-white'
                        : 'bg-dark-surface border border-gray-800 text-gray-300 hover:border-gray-700'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 bg-dark-surface border border-gray-800 rounded text-sm text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:border-gray-700"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
