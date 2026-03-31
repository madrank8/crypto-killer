'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GenerateProgressOverlay, useGenerateWithProgress } from '@/components/GenerateProgress';

/* ─── KPI Card with optional sub-stat ─── */
function KpiCard({ label, value, sub, accent = 'text-white', icon }) {
  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition group">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="text-gray-700 group-hover:text-gray-500 transition">{icon}</span>
      </div>
      <div className={`text-3xl font-bold ${accent}`}>{value ?? '—'}</div>
      {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
    </div>
  );
}

/* ─── Pipeline Funnel Bar ─── */
function PipelineFunnel({ total, noReview, draft, published }) {
  const pNoReview = total > 0 ? (noReview / total) * 100 : 0;
  const pDraft = total > 0 ? (draft / total) * 100 : 0;
  const pPublished = total > 0 ? (published / total) * 100 : 0;

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Review Pipeline</h3>
      <div className="h-4 bg-dark-bg rounded-full overflow-hidden flex mb-4 border border-gray-800">
        {pPublished > 0 && (
          <div className="bg-green-600 h-full transition-all duration-700" style={{ width: `${pPublished}%` }} title={`Published: ${published}`} />
        )}
        {pDraft > 0 && (
          <div className="bg-amber-600 h-full transition-all duration-700" style={{ width: `${pDraft}%` }} title={`Draft: ${draft}`} />
        )}
        {pNoReview > 0 && (
          <div className="bg-gray-700 h-full transition-all duration-700" style={{ width: `${pNoReview}%` }} title={`No Review: ${noReview}`} />
        )}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-lg font-bold text-green-400">{published}</div>
          <div className="flex items-center justify-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-green-600" />
            <span className="text-xs text-gray-500">Published</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-amber-400">{draft}</div>
          <div className="flex items-center justify-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-amber-600" />
            <span className="text-xs text-gray-500">Drafts</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-gray-400">{noReview}</div>
          <div className="flex items-center justify-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-gray-700" />
            <span className="text-xs text-gray-500">No Review</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Velocity Breakdown Mini-Chart ─── */
function VelocityBreakdown({ data }) {
  if (!data) return null;

  const items = [
    { key: 'surging', label: 'Surging', color: 'bg-red-500', text: 'text-red-400' },
    { key: 'rising', label: 'Rising', color: 'bg-orange-500', text: 'text-orange-400' },
    { key: 'new', label: 'New', color: 'bg-blue-500', text: 'text-blue-400' },
    { key: 'stable', label: 'Stable', color: 'bg-gray-500', text: 'text-gray-400' },
    { key: 'declining', label: 'Declining', color: 'bg-green-600', text: 'text-green-400' },
    { key: 'dead', label: 'Dead', color: 'bg-gray-800', text: 'text-gray-600' },
  ];

  const total = items.reduce((sum, i) => sum + (data[i.key] || 0), 0);

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Velocity Trends</h3>
      <div className="h-3 bg-dark-bg rounded-full overflow-hidden flex mb-4 border border-gray-800">
        {items.map(item => {
          const count = data[item.key] || 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div key={item.key} className={`${item.color} h-full transition-all duration-700`} style={{ width: `${pct}%` }} title={`${item.label}: ${count}`} />
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {items.map(item => {
          const count = data[item.key] || 0;
          if (count === 0) return null;
          return (
            <div key={item.key} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${item.color} shrink-0`} />
              <span className="text-xs text-gray-500">{item.label}</span>
              <span className={`text-xs font-bold ${item.text} ml-auto`}>{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Score Distribution Card ─── */
function ScoreDistribution({ data }) {
  if (!data) return null;

  const items = [
    { key: 'critical', label: 'Critical (80+)', color: 'bg-red-600', text: 'text-red-400' },
    { key: 'high', label: 'High (60-79)', color: 'bg-orange-600', text: 'text-orange-400' },
    { key: 'medium', label: 'Medium (40-59)', color: 'bg-amber-600', text: 'text-amber-400' },
    { key: 'low', label: 'Low (<40)', color: 'bg-gray-600', text: 'text-gray-400' },
  ];

  const total = items.reduce((sum, i) => sum + (data[i.key] || 0), 0);

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Scam Score Distribution</h3>
      <div className="space-y-2.5">
        {items.map(item => {
          const count = data[item.key] || 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={item.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">{item.label}</span>
                <span className={`text-xs font-bold ${item.text}`}>{count.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-dark-bg rounded-full overflow-hidden border border-gray-800">
                <div className={`${item.color} h-full rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Priority Queue Card ─── */
function PriorityQueueCard({ brands, onGenerate, generatingId, gen }) {
  if (brands.length === 0) {
    return (
      <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Priority Queue</h3>
        </div>
        <div className="text-center py-8">
          <span className="text-3xl mb-3 block">&#10003;</span>
          <p className="text-gray-500 text-sm">All high-priority brands have reviews</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-white">Priority Queue</h3>
        <Link href="/admin/brands?filter=no-review" className="text-xs text-gray-500 hover:text-gray-300 transition">
          View all &rarr;
        </Link>
      </div>
      <p className="text-xs text-gray-600 mb-4">Highest velocity brands without a review</p>
      <div className="space-y-0">
        {brands.map((b, idx) => {
          const isGenerating = generatingId === b.id || generatingId?.brandId === b.id;
          return (
            <div key={b.id} className="flex items-center gap-3 py-3 border-b border-gray-800/50 last:border-0 group">
              <span className="text-xs text-gray-600 font-mono w-5 text-right shrink-0">{idx + 1}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
                b.scam_score >= 80 ? 'bg-red-950 text-red-300' : b.scam_score >= 60 ? 'bg-orange-950 text-orange-300' : 'bg-amber-950 text-amber-300'
              }`}>{b.scam_score}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{b.name}</p>
                <p className="text-xs text-gray-600">
                  {b.total_creatives} ads &middot; {b.velocity_7d}/wk
                  {b.trend && (
                    <span className={`ml-1.5 ${
                      b.trend === 'surging' ? 'text-red-400' : b.trend === 'rising' ? 'text-orange-400' : 'text-gray-500'
                    }`}>{b.trend}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => onGenerate(b.id)}
                disabled={isGenerating || gen.isGenerating}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                  isGenerating
                    ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30'
                    : 'text-red-400 hover:text-white hover:bg-red-600 border border-transparent hover:border-red-600 opacity-0 group-hover:opacity-100'
                }`}
              >{isGenerating ? 'Generating...' : 'Generate'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Published Reviews Card ─── */
function PublishedReviewsCard({ reviews }) {
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-white">Recent Reviews</h3>
        <Link href="/admin/reviews" className="text-xs text-gray-500 hover:text-gray-300 transition">
          View all &rarr;
        </Link>
      </div>
      <p className="text-xs text-gray-600 mb-4">Latest published and draft reviews</p>
      {reviews.length === 0 ? (
        <p className="text-gray-600 text-sm py-4 text-center">No reviews yet</p>
      ) : (
        <div className="space-y-0">
          {reviews.map((r) => (
            <Link key={r.id} href={`/admin/review/${r.id}`}
              className="flex items-center gap-3 py-3 border-b border-gray-800/50 last:border-0 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition">
              <div className={`w-2 h-2 rounded-full shrink-0 ${r.status === 'published' ? 'bg-green-500' : 'bg-amber-500'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{r.brand_name || r.title || 'Untitled'}</p>
                <p className="text-xs text-gray-600">
                  {r.word_count > 0 ? `${r.word_count.toLocaleString()} words` : 'Empty'}
                  {r.scam_score > 0 && ` · Score ${r.scam_score}`}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                r.status === 'published' ? 'bg-green-950 text-green-300' : 'bg-amber-950 text-amber-300'
              }`}>{r.status}</span>
              <span className="text-xs text-gray-600 shrink-0">{formatTime(r.updated_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Quick Action Button ─── */
function QuickAction({ label, description, icon, onClick, variant = 'default' }) {
  const styles = {
    primary: 'bg-red-600/10 border-red-600/20 hover:bg-red-600/20 hover:border-red-600/30',
    default: 'bg-dark-card border-gray-800 hover:bg-dark-surface hover:border-gray-700',
  };
  return (
    <button onClick={onClick}
      className={`${styles[variant]} border rounded-xl p-4 text-left transition-all duration-200 w-full group`}>
      <div className="flex items-center gap-3">
        <div className="text-xl group-hover:scale-110 transition-transform shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="text-white font-semibold text-sm">{label}</div>
          <div className="text-gray-500 text-xs mt-0.5 truncate">{description}</div>
        </div>
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════
   MAIN DASHBOARD PAGE
   ═══════════════════════════════════════════ */

export default function AdminDashboard() {
  const { token } = useAdmin();
  const router = useRouter();

  const [stats, setStats] = useState(null);
  const [brands, setBrands] = useState([]);
  const [recentReviews, setRecentReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState(null);

  const gen = useGenerateWithProgress(token);

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      try {
        const [statsRes, brandsRes, reviewsRes] = await Promise.all([
          fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/brands?sort=velocity&limit=15&review_status=none', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/admin/reviews/list', {
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
          const sorted = (data.reviews || [])
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .slice(0, 10);
          setRecentReviews(sorted);
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
      const createRes = await fetch('/api/admin/reviews/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_id: brandId }),
      });
      if (!createRes.ok) throw new Error('Create failed');
      const { review_id } = await createRes.json();
      await gen.generate(brandId);
      setGeneratingId({ brandId, reviewId: review_id });
    } catch (err) {
      console.error('Generate error:', err);
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

  const coveragePercent = stats
    ? Math.round((stats.brands_with_review / Math.max(stats.total_brands, 1)) * 100)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-gray-500 text-sm">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Command Center</h1>
          <p className="text-gray-500 text-sm mt-1">
            {stats ? `${stats.total_brands.toLocaleString()} brands tracked · ${stats.total_creatives.toLocaleString()} creatives analyzed` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/brands"
            className="text-sm font-medium px-4 py-2 rounded-lg bg-dark-card text-gray-300 hover:text-white border border-gray-800 hover:border-gray-700 transition">
            All Brands
          </Link>
          <Link href="/admin/reviews"
            className="text-sm font-medium px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition">
            Reviews
          </Link>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Total Brands" value={stats?.total_brands?.toLocaleString()} accent="text-white"
          sub={`${stats?.active_brands || 0} active this week`}
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>} />
        <KpiCard label="Creatives" value={stats?.total_creatives?.toLocaleString()} accent="text-red-400"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" /></svg>} />
        <KpiCard label="Published" value={stats?.published_reviews} accent="text-green-400"
          sub={`${stats?.draft_reviews || 0} drafts pending`}
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
        <KpiCard label="Coverage" value={`${coveragePercent}%`} accent="text-amber-400"
          sub={`${stats?.brands_without_review?.toLocaleString() || 0} need reviews`}
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>} />
        <KpiCard label="High Priority" value={stats?.high_priority_unreviewed || 0}
          accent={stats?.high_priority_unreviewed > 0 ? 'text-red-400' : 'text-green-400'}
          sub="Surging/rising, score 60+"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" /></svg>} />
      </div>

      {/* Pipeline + Velocity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PipelineFunnel total={stats?.total_brands || 0} noReview={stats?.brands_without_review || 0}
          draft={stats?.draft_reviews || 0} published={stats?.published_reviews || 0} />
        <VelocityBreakdown data={stats?.velocity_breakdown} />
      </div>

      {/* Score Distribution + Quick Actions Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ScoreDistribution data={stats?.score_distribution} />
        <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 gap-3">
            <QuickAction label="Browse All Brands" description="Search, filter, and manage tracked scam brands"
              icon="&#127919;" onClick={() => router.push('/admin/brands')} />
            <QuickAction label="Manage Reviews" description="Edit drafts and manage published reviews"
              icon="&#128221;" onClick={() => router.push('/admin/reviews')} />
            <QuickAction label="SpyOwl Settings" description="Configure scraper connection"
              icon="&#128065;" onClick={() => router.push('/admin/settings')} />
          </div>
        </div>
      </div>

      {/* Priority Queue + Recent Reviews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PriorityQueueCard brands={brands.slice(0, 10)} onGenerate={handleOneClickGenerate}
          generatingId={generatingId} gen={gen} />
        <PublishedReviewsCard reviews={recentReviews} />
      </div>
    </div>
  );
}
