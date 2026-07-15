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

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ReviewsPage() {
  const { token } = useAdmin();
  const searchParams = useSearchParams();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/reviews/list', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error('Failed to fetch reviews');

        const data = await res.json();
        setReviews(data.reviews || []);
        setStats(data.stats || { total: 0, drafts: 0, published: 0 });
        setError('');
      } catch (err) {
        console.error('Error loading reviews:', err);
        setError('Failed to load reviews: ' + (err.message || 'network error'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]);

  const filtered = reviews.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!(r.brand_name || '').toLowerCase().includes(q) && !(r.title || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reviews</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage your scam brand reviews
          </p>
        </div>
        <Link href="/admin/brands?filter=no-review">
          <button className="text-sm font-medium px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition flex items-center gap-1.5">
            <span>+</span> New Review
          </button>
        </Link>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-950/50 border border-red-600/30 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-red-300 text-sm">{error}</span>
          </div>
          <button onClick={() => window.location.reload()} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-600/10 transition">Retry</button>
        </div>
      )}

      {/* Search + Status Tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reviews..." className="search-input w-full text-sm py-2 pl-9 pr-8" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
          )}
        </div>
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
      </div>

      {/* Reviews List */}
      <div className="space-y-2">
        {filtered.map((review) => (
          <Link key={review.id} href={`/admin/review/${review.id}`}>
            <div className="bg-dark-card border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4 transition hover:border-gray-700 cursor-pointer group">
              {/* Status Dot */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                review.status === 'published' ? 'bg-green-500' : 'bg-amber-500'
              }`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm group-hover:text-red-400 transition truncate">
                    {review.brand_name}
                  </span>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    review.status === 'published'
                      ? 'bg-green-950 text-green-300'
                      : 'bg-amber-950 text-amber-300'
                  }`}>
                    {review.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                  <span>Score: {review.scam_score}</span>
                  <span>{review.total_creatives} ads</span>
                  {review.total_geos > 0 && <span>{review.total_geos} countries</span>}
                  <span>{Number(review.word_count) > 0 ? `${Number(review.word_count).toLocaleString()} words` : 'Empty'}</span>
                  <span className="text-gray-600">Updated {timeAgo(review.updated_at)}</span>
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
