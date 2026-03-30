'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function StatusTab({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`ml-1.5 text-xs ${active ? 'text-gray-300' : 'text-gray-600'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function ReviewsPage() {
  const { token } = useAdmin();
  const searchParams = useSearchParams();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      setLoading(true);
      try {
        // Fetch all brands that have reviews
        const [draftRes, pubRes] = await Promise.all([
          fetch('/api/admin/brands?sort=creative_volume&limit=200&review_status=draft', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/admin/brands?sort=creative_volume&limit=200&review_status=published', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const drafts = draftRes.ok ? (await draftRes.json()).brands || [] : [];
        const published = pubRes.ok ? (await pubRes.json()).brands || [] : [];

        // Tag them
        const allReviews = [
          ...drafts.map((b) => ({ ...b, _status: 'draft' })),
          ...published.map((b) => ({ ...b, _status: 'published' })),
        ];

        setReviews(allReviews);
        setStats({ drafts: drafts.length, published: published.length, total: allReviews.length });
      } catch (err) {
        console.error('Error loading reviews:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]);

  const filtered =
    statusFilter === 'all'
      ? reviews
      : reviews.filter((r) => r._status === statusFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Reviews</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage your scam brand reviews
        </p>
      </div>

      {/* Status Tabs */}
      <div className="flex items-center gap-1 bg-dark-card border border-gray-800 rounded-xl p-1 w-fit">
        <StatusTab
          label="All"
          count={stats?.total}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatusTab
          label="Drafts"
          count={stats?.drafts}
          active={statusFilter === 'draft'}
          onClick={() => setStatusFilter('draft')}
        />
        <StatusTab
          label="Published"
          count={stats?.published}
          active={statusFilter === 'published'}
          onClick={() => setStatusFilter('published')}
        />
      </div>

      {/* Reviews List */}
      <div className="space-y-2">
        {filtered.map((review) => (
          <Link key={review.id} href={`/admin/review/${review.review_id}`}>
            <div className="bg-dark-card border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4 transition hover:border-gray-700 cursor-pointer group">
              {/* Status Dot */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                review._status === 'published' ? 'bg-green-500' : 'bg-amber-500'
              }`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm group-hover:text-red-400 transition truncate">
                    {review.name}
                  </span>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    review._status === 'published'
                      ? 'bg-green-950 text-green-300'
                      : 'bg-amber-950 text-amber-300'
                  }`}>
                    {review._status}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                  <span>Score: {review.scam_score}</span>
                  <span>{review.total_creatives} ads tracked</span>
                  {review.geo_count > 0 && <span>{review.geo_count} countries</span>}
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        ))}

        {filtered.length === 0 && !loading && (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-3">
              {statusFilter === 'all'
                ? 'No reviews yet'
                : `No ${statusFilter} reviews`}
            </p>
            <Link href="/admin/brands?filter=no-review">
              <button className="text-sm text-red-400 hover:text-red-300 px-4 py-2 rounded-lg bg-red-600/10 hover:bg-red-600/20 border border-red-600/20 transition">
                Generate your first review
              </button>
            </Link>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <span className="animate-spin">⟳</span> Loading reviews...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
