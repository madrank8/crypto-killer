'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GenerateProgressOverlay, useGenerateWithProgress } from '@/components/GenerateProgress';

/* ─── Stat Card ─── */
function StatCard({ label, value, icon, accent = 'text-red-400' }) {
  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="text-gray-600">{icon}</span>
      </div>
      <div className={`text-3xl font-bold ${accent}`}>{value ?? '—'}</div>
    </div>
  );
}

/* ─── Quick Action Button ─── */
function QuickAction({ label, description, icon, onClick, loading, variant = 'default' }) {
  const styles = {
    primary: 'bg-red-600/10 border-red-600/20 hover:bg-red-600/20 hover:border-red-600/30',
    default: 'bg-dark-card border-gray-800 hover:bg-dark-surface hover:border-gray-700',
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`${styles[variant]} border rounded-xl p-5 text-left transition-all duration-200 w-full group`}
    >
      <div className="flex items-start gap-4">
        <div className={`text-2xl ${loading ? 'animate-spin' : 'group-hover:scale-110 transition-transform'}`}>
          {loading ? '⟳' : icon}
        </div>
        <div>
          <div className="text-white font-semibold text-sm">{label}</div>
          <div className="text-gray-500 text-xs mt-0.5">{description}</div>
        </div>
      </div>
    </button>
  );
}

/* ─── Activity Item ─── */
function ActivityItem({ brand, action, time, status }) {
  const statusColors = {
    published: 'bg-green-500',
    draft: 'bg-amber-500',
    generated: 'bg-blue-500',
    created: 'bg-gray-500',
  };

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-800/50 last:border-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[status] || 'bg-gray-600'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 truncate">
          <span className="text-white font-medium">{brand}</span>
          {' '}{action}
        </p>
      </div>
      <span className="text-xs text-gray-600 shrink-0">{time}</span>
    </div>
  );
}

/* ─── Needs Review Card ─── */
function NeedsReviewCard({ brand, score, creatives, velocity, onGenerate, generating }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-800/50 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`text-sm font-bold ${score >= 70 ? 'text-red-400' : score >= 50 ? 'text-amber-400' : 'text-green-400'}`}>
          {score}
        </span>
        <div className="min-w-0">
          <p className="text-sm text-white font-medium truncate">{brand}</p>
          <p className="text-xs text-gray-500">{creatives} ads · {velocity}/wk</p>
        </div>
      </div>
      <button
        onClick={onGenerate}
        disabled={generating}
        className="text-xs font-medium text-red-400 hover:text-red-300 transition shrink-0 px-3 py-1.5 rounded-lg hover:bg-red-600/10"
      >
        {generating ? '...' : 'Generate'}
      </button>
    </div>
  );
}

export default function AdminDashboard() {
  const { token } = useAdmin();
  const router = useRouter();

  const [stats, setStats] = useState(null);
  const [brands, setBrands] = useState([]);
  const [recentReviews, setRecentReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);

  // AI Generate with progress tracking
  const gen = useGenerateWithProgress(token);

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      try {
        const [statsRes, brandsRes, reviewsRes] = await Promise.all([
          fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/brands?sort=velocity&limit=10&review_status=none', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/admin/brands?sort=creative_volume&limit=10&review_status=published', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (statsRes.ok) setStats(await statsRes.json());
        if (brandsRes.ok) {
          const data = await brandsRes.json();
          setBrands(data.brands || []);
        }
        if (reviewsRes.ok) {
          const data = await reviewsRes.json();
          setRecentReviews(data.brands || []);
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]);

  const handleOneClickGenerate = async (brandId) => {
    setGeneratingId(brandId);
    try {
      // Create review first
      const createRes = await fetch('/api/admin/reviews/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_id: brandId }),
      });

      if (!createRes.ok) throw new Error('Create failed');
      const { review_id } = await createRes.json();

      // Now generate with progress tracking
      await gen.generate(brandId);

      // Store review_id for navigation after progress overlay closes
      setGeneratingId({ brandId, reviewId: review_id });
    } catch (err) {
      console.error('Generate error:', err);
      alert('Error creating review');
      setGeneratingId(null);
    }
  };

  const handleGenDone = () => {
    const reviewId = generatingId?.reviewId;
    gen.reset();
    setGeneratingId(null);
    if (reviewId) {
      router.push(`/admin/review/${reviewId}`);
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const coveragePercent = stats
    ? Math.round(((stats.published_reviews + stats.draft_reviews) / Math.max(stats.total_brands, 1)) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* AI Generation Progress Overlay */}
      {gen.isGenerating && (
        <GenerateProgressOverlay
          progress={gen.progress}
          step={gen.step}
          message={gen.message}
          error={gen.error}
          onClose={handleGenDone}
        />
      )}

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Command Center</h1>
        <p className="text-gray-500 text-sm mt-1">
          Overview of your scam intelligence pipeline
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Brands"
          value={stats?.total_brands}
          accent="text-white"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          }
        />
        <StatCard
          label="Creatives Tracked"
          value={stats?.total_creatives?.toLocaleString()}
          accent="text-red-400"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          }
        />
        <StatCard
          label="Published Reviews"
          value={stats?.published_reviews}
          accent="text-green-400"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Coverage"
          value={`${coveragePercent}%`}
          accent="text-amber-400"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          }
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickAction
            label="View All Brands"
            description="Browse and manage tracked scam brands"
            icon="🎯"
            onClick={() => router.push('/admin/brands')}
            variant="default"
          />
          <QuickAction
            label="View Reviews"
            description="Manage drafts and published reviews"
            icon="📝"
            onClick={() => router.push('/admin/reviews')}
            variant="default"
          />
          <QuickAction
            label="Open Public Site"
            description="View the live Crypto Killer website"
            icon="🌐"
            onClick={() => window.open('https://crypto-killer.base44.app', '_blank')}
            variant="default"
          />
        </div>
      </div>

      {/* Two-column: Needs Review + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Needs Review */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm">Needs Review</h3>
            <Link href="/admin/brands?filter=no-review" className="text-xs text-gray-500 hover:text-gray-300 transition">
              View all →
            </Link>
          </div>
          {brands.length === 0 && !loading ? (
            <p className="text-gray-600 text-sm py-4 text-center">All brands have reviews</p>
          ) : (
            <div>
              {brands.slice(0, 6).map((b) => (
                <NeedsReviewCard
                  key={b.id}
                  brand={b.name}
                  score={b.scam_score}
                  creatives={b.total_creatives}
                  velocity={b.velocity_7d}
                  onGenerate={() => handleOneClickGenerate(b.id)}
                  generating={generatingId === b.id || (generatingId?.brandId === b.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recent Published */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm">Published Reviews</h3>
            <Link href="/admin/reviews?status=published" className="text-xs text-gray-500 hover:text-gray-300 transition">
              View all →
            </Link>
          </div>
          {recentReviews.length === 0 && !loading ? (
            <p className="text-gray-600 text-sm py-4 text-center">No published reviews yet</p>
          ) : (
            <div>
              {recentReviews.slice(0, 6).map((b) => (
                <ActivityItem
                  key={b.id}
                  brand={b.name}
                  action="review published"
                  time={formatTime(b.last_seen_at)}
                  status="published"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
