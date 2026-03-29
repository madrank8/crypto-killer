'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function StatCard({ label, value, loading = false }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {loading ? '-' : value}
      </div>
    </div>
  );
}

function TrendBadge({ trend }) {
  const config = {
    surging: { bg: 'bg-red-500 animate-pulse', text: 'text-white' },
    rising: { bg: 'bg-orange-500', text: 'text-white' },
    stable: { bg: 'bg-gray-600', text: 'text-white' },
    declining: { bg: 'bg-blue-500', text: 'text-white' },
    dead: { bg: 'bg-gray-700', text: 'text-gray-400' },
  };

  const style = config[trend] || config.stable;

  return (
    <span className={`badge ${style.bg} ${style.text} text-xs`}>
      {trend}
    </span>
  );
}

function ScamScoreBadge({ score }) {
  let color = 'text-green-400';
  if (score >= 70) color = 'text-red-400';
  else if (score >= 50) color = 'text-amber-400';

  return <span className={`font-semibold ${color}`}>{score}</span>;
}

function ReviewStatusBadge({ status }) {
  const config = {
    none: { badge: 'badge', bg: 'bg-gray-700', text: 'text-gray-300' },
    draft: { badge: 'badge badge-warning', bg: '', text: '' },
    published: { badge: 'badge badge-success', bg: '', text: '' },
  };

  const style = config[status] || config.none;

  return <span className={style.badge}>{status || 'None'}</span>;
}

export default function AdminDashboard() {
  const { token } = useAdmin();
  const router = useRouter();

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [brands, setBrands] = useState([]);
  const [brandsLoading, setBrandsLoading] = useState(true);

  const [sortBy, setSortBy] = useState('creative_volume');
  const [trendFilter, setTrendFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [generatingReviewId, setGeneratingReviewId] = useState(null);

  // Fetch stats
  useEffect(() => {
    if (!token) return;

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [token]);

  // Fetch brands
  useEffect(() => {
    if (!token) return;

    const fetchBrands = async () => {
      setBrandsLoading(true);
      try {
        const params = new URLSearchParams({
          sort: sortBy,
          trend: trendFilter,
          review_status: reviewFilter,
          page,
          limit: 50,
        });

        const res = await fetch(`/api/admin/brands?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (page === 1) {
            setBrands(data.brands);
          } else {
            setBrands((prev) => [...prev, ...data.brands]);
          }
          setHasMore(data.has_more);
        }
      } catch (err) {
        console.error('Error fetching brands:', err);
      } finally {
        setBrandsLoading(false);
      }
    };

    fetchBrands();
  }, [token, sortBy, trendFilter, reviewFilter, page]);

  const handleGenerateReview = async (brandId) => {
    setGeneratingReviewId(brandId);

    try {
      const res = await fetch('/api/admin/reviews/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ brand_id: brandId }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/admin/review/${data.review_id}`);
      } else {
        alert('Error generating review');
      }
    } catch (err) {
      console.error('Error generating review:', err);
      alert('Error generating review');
    } finally {
      setGeneratingReviewId(null);
    }
  };

  const shouldHighlightBrand = (brand) => {
    return (
      !brand.review_status &&
      brand.total_creatives > 50 &&
      brand.velocity_7d > 0
    );
  };

  return (
    <div className="space-y-8">
      {/* Section A: Stats Cards */}
      <div>
        <h2 className="section-title">Overview</h2>
        <div className="grid grid-cols-5 gap-4">
          <StatCard
            label="Total Brands"
            value={stats?.total_brands}
            loading={statsLoading}
          />
          <StatCard
            label="Total Creatives"
            value={stats?.total_creatives}
            loading={statsLoading}
          />
          <StatCard
            label="Active Brands"
            value={stats?.active_brands}
            loading={statsLoading}
          />
          <StatCard
            label="Published Reviews"
            value={stats?.published_reviews}
            loading={statsLoading}
          />
          <StatCard
            label="Draft Reviews"
            value={stats?.draft_reviews}
            loading={statsLoading}
          />
        </div>
      </div>

      {/* Section B: Brand Triage Table */}
      <div>
        <h2 className="section-title">Brand Triage</h2>

        {/* Filters */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              className="search-input w-full"
            >
              <option value="creative_volume">Creative Volume</option>
              <option value="velocity">Velocity</option>
              <option value="scam_score">Scam Score</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Trend
            </label>
            <select
              value={trendFilter}
              onChange={(e) => {
                setTrendFilter(e.target.value);
                setPage(1);
              }}
              className="search-input w-full"
            >
              <option value="all">All</option>
              <option value="surging">Surging</option>
              <option value="rising">Rising</option>
              <option value="stable">Stable</option>
              <option value="declining">Declining</option>
              <option value="dead">Dead</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Review Status
            </label>
            <select
              value={reviewFilter}
              onChange={(e) => {
                setReviewFilter(e.target.value);
                setPage(1);
              }}
              className="search-input w-full"
            >
              <option value="all">All</option>
              <option value="none">No Review</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="card border-gray-700 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Brand
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Scam Score
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Creatives
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Velocity 7d
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  GEOs
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Celebrities
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Review
                </th>
                <th className="text-left py-3 px-4 text-gray-300 font-semibold text-sm">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr
                  key={brand.id}
                  className={`border-b border-gray-700 hover:bg-dark-surface transition ${
                    shouldHighlightBrand(brand) ? 'border-l-4 border-l-yellow-400' : ''
                  }`}
                >
                  <td className="py-3 px-4 text-white font-semibold">
                    {brand.name}
                  </td>
                  <td className="py-3 px-4">
                    <ScamScoreBadge score={brand.scam_score} />
                  </td>
                  <td className="py-3 px-4 text-gray-300">
                    {brand.total_creatives}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300">{brand.velocity_7d}</span>
                      <TrendBadge trend={brand.trend} />
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300">
                    {brand.geo_count}
                  </td>
                  <td className="py-3 px-4 text-gray-300">
                    {brand.celebrity_count}
                  </td>
                  <td className="py-3 px-4">
                    <ReviewStatusBadge status={brand.review_status} />
                  </td>
                  <td className="py-3 px-4">
                    {brand.review_id ? (
                      <Link href={`/admin/review/${brand.review_id}`}>
                        <button className="btn btn-secondary text-sm">
                          Edit Review
                        </button>
                      </Link>
                    ) : (
                      <button
                        onClick={() => handleGenerateReview(brand.id)}
                        disabled={generatingReviewId === brand.id}
                        className="btn btn-primary text-sm"
                      >
                        {generatingReviewId === brand.id
                          ? 'Generating...'
                          : 'Generate Review'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {brands.length === 0 && !brandsLoading && (
            <div className="py-8 text-center text-gray-400">
              No brands found
            </div>
          )}

          {brandsLoading && (
            <div className="py-8 text-center text-gray-400">Loading...</div>
          )}
        </div>

        {/* Load More */}
        {hasMore && (
          <div className="mt-6 text-center">
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={brandsLoading}
              className="btn btn-secondary"
            >
              {brandsLoading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
