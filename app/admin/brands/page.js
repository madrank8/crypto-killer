'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function TrendBadge({ trend }) {
  const config = {
    surging: 'bg-red-500/20 text-red-300 border-red-500/30',
    rising: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    stable: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    declining: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    dead: 'bg-gray-700/20 text-gray-500 border-gray-700/30',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${config[trend] || config.stable}`}>
      {trend}
    </span>
  );
}

function ScamScoreChip({ score }) {
  let color = 'text-green-400 bg-green-500/10';
  if (score >= 70) color = 'text-red-400 bg-red-500/10';
  else if (score >= 50) color = 'text-amber-400 bg-amber-500/10';
  return (
    <span className={`inline-flex items-center justify-center w-10 h-7 rounded text-xs font-bold ${color}`}>
      {score}
    </span>
  );
}
export default function BrandsPage() {
  const { token } = useAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('creative_volume');
  const [trendFilter, setTrendFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState(
    searchParams.get('filter') === 'no-review' ? 'none' : 'all'
  );

  const [generatingId, setGeneratingId] = useState(null);

  const fetchBrands = useCallback(async (pageNum = 1, append = false) => {
    if (!token) return;
    setLoading(true);

    try {
      const params = new URLSearchParams({
        sort: sortBy,
        trend: trendFilter,
        review_status: reviewFilter,
        page: pageNum,
        limit: 30,
      });
      const res = await fetch(`/api/admin/brands?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        let results = data.brands || [];

        // Client-side search filter
        if (search.trim()) {
          const q = search.toLowerCase();
          results = results.filter((b) => b.name.toLowerCase().includes(q));
        }

        if (append) {
          setBrands((prev) => [...prev, ...results]);
        } else {
          setBrands(results);
        }
        setHasMore(data.has_more);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Error loading brands:', err);
    } finally {
      setLoading(false);
    }
  }, [token, sortBy, trendFilter, reviewFilter, search]);

  useEffect(() => {
    setPage(1);
    fetchBrands(1);
  }, [fetchBrands]);
  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchBrands(next, true);
  };

  const handleOneClickGenerate = async (brandId) => {
    setGeneratingId(brandId);
    try {
      const createRes = await fetch('/api/admin/reviews/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_id: brandId }),
      });

      if (!createRes.ok) throw new Error('Create failed');
      const { review_id } = await createRes.json();

      const genRes = await fetch('/api/admin/reviews/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_id: brandId }),
      });

      if (genRes.ok) {
        router.push(`/admin/review/${review_id}`);
      } else {
        alert('AI generation failed. Opening empty draft.');
        router.push(`/admin/review/${review_id}`);
      }
    } catch (err) {
      console.error('Generate error:', err);
      alert('Error creating review');
    } finally {
      setGeneratingId(null);
    }
  };
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Funnels</h1>
          <p className="text-gray-500 text-sm mt-1">
            {total} scam funnels tracked
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="flex-1 min-w-[200px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands..."
            className="search-input w-full text-sm py-2"
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="search-input text-sm py-2 w-auto"
        >
          <option value="creative_volume">Most Ads</option>
          <option value="velocity">Most Active</option>
          <option value="scam_score">Highest Score</option>
        </select>
        {/* Trend */}
        <select
          value={trendFilter}
          onChange={(e) => setTrendFilter(e.target.value)}
          className="search-input text-sm py-2 w-auto"
        >
          <option value="all">All Trends</option>
          <option value="surging">Surging</option>
          <option value="rising">Rising</option>
          <option value="stable">Stable</option>
          <option value="declining">Declining</option>
          <option value="dead">Dead</option>
        </select>

        {/* Review Status */}
        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value)}
          className="search-input text-sm py-2 w-auto"
        >
          <option value="all">All Statuses</option>
          <option value="none">No Review</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>

      {/* Brands List */}
      <div className="space-y-2">        {brands.map((brand) => (
          <div
            key={brand.id}
            className={`bg-dark-card border rounded-xl px-5 py-4 flex items-center gap-4 transition hover:border-gray-700 ${
              !brand.review_status && brand.total_creatives > 50
                ? 'border-amber-600/30'
                : 'border-gray-800'
            }`}
          >
            {/* Score */}
            <ScamScoreChip score={brand.scam_score} />

            {/* Brand Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-sm truncate">{brand.name}</span>
                <TrendBadge trend={brand.trend} />
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                <span>{brand.total_creatives} ads</span>
                <span>{brand.velocity_7d}/wk</span>
                <span>{brand.geo_count} countries</span>
                {brand.celebrity_count > 0 && (
                  <span className="text-amber-500">{brand.celebrity_count} celebs</span>
                )}
              </div>
            </div>
            {/* Review Status + Action */}
            <div className="flex items-center gap-3 shrink-0">
              {brand.review_status === 'published' ? (
                <>
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-green-950 text-green-300">
                    Published
                  </span>
                  <Link href={`/admin/review/${brand.review_id}`}>
                    <button className="text-xs font-medium text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition">
                      Edit
                    </button>
                  </Link>
                </>
              ) : brand.review_status === 'draft' ? (
                <>
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950 text-amber-300">
                    Draft
                  </span>
                  <Link href={`/admin/review/${brand.review_id}`}>
                    <button className="text-xs font-medium text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-600/10 transition">
                      Continue
                    </button>
                  </Link>
                </>
              ) : (
                <button
                  onClick={() => handleOneClickGenerate(brand.id)}
                  disabled={generatingId === brand.id}
                  className="text-xs font-semibold text-red-400 hover:text-red-300 px-4 py-2 rounded-lg bg-red-600/10 hover:bg-red-600/20 border border-red-600/20 transition"
                >                  {generatingId === brand.id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="animate-spin">⟳</span> Generating...
                    </span>
                  ) : (
                    'Generate Review'
                  )}
                </button>
              )}
            </div>
          </div>
        ))}

        {brands.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-600">
            No brands match your filters
          </div>
        )}

        {loading && brands.length === 0 && (
          <div className="text-center py-12">
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <span className="animate-spin">⟳</span> Loading brands...
            </div>
          </div>
        )}
      </div>

      {/* Load More */}
      {hasMore && brands.length > 0 && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loading}
            className="text-sm text-gray-400 hover:text-white px-6 py-2 rounded-lg border border-gray-800 hover:border-gray-700 transition"
          >            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}