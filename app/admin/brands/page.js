'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GenerateProgressOverlay, useGenerateWithProgress } from '@/components/GenerateProgress';

/* ─── Geo flag helper ─── */
function geoFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const offset = 127397;
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => c.charCodeAt(0) + offset));
}

/* ─── Format numbers with K/M suffix ─── */
function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

/* ─── Time ago helper ─── */
function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ─── Stat Card ─── */
function StatCard({ label, value, sub, accent = 'text-white' }) {
  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── Trend Pill (for stats) ─── */
function TrendPill({ trend, count, ads }) {
  const colors = {
    surging: 'bg-red-500/15 text-red-400 border-red-500/20',
    rising: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    stable: 'bg-gray-500/15 text-gray-300 border-gray-500/20',
    declining: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    dead: 'bg-gray-700/15 text-gray-600 border-gray-700/20',
  };
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${colors[trend] || colors.stable}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold capitalize">{trend}</span>
        <span className="text-[10px] opacity-60">{fmt(ads)} ads</span>
      </div>
      <span className="text-sm font-bold">{fmt(count)}</span>
    </div>
  );
}

/* ─── Scrape History Row ─── */
function ScrapeRow({ run }) {
  const isOk = run.status === 'completed';
  return (
    <div className="flex items-center gap-3 text-xs py-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOk ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-gray-400 w-16 shrink-0">{timeAgo(run.finished_at || run.started_at)}</span>
      <span className="text-gray-300 flex-1 truncate">
        {fmt(run.creatives_synced)} synced
        {run.brands_updated > 0 && ` · ${fmt(run.brands_updated)} brands`}
      </span>
      <span className="text-gray-600 shrink-0">{run.trigger_type}</span>
    </div>
  );
}

/* ─── Brand list components ─── */
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

/* ─── Locale picker config (Phase 0) ─────────────────────────────────
   V1 supported review locales. Only EN is wired to the generation
   pipeline today — IT/ES/DE/FR/PT-BR appear in the picker as "soon" so
   the UI is forward-compatible with Phase 2 translation flow. Keep
   ordering aligned with /api/admin/brands SUPPORTED_LOCALES. */
const LOCALES = [
  { code: 'en',    label: 'English',    flag: '🇬🇧', ready: true  },
  { code: 'it',    label: 'Italian',    flag: '🇮🇹', ready: false },
  { code: 'es',    label: 'Spanish',    flag: '🇪🇸', ready: false },
  { code: 'de',    label: 'German',     flag: '🇩🇪', ready: false },
  { code: 'fr',    label: 'French',     flag: '🇫🇷', ready: false },
  { code: 'pt-BR', label: 'Portuguese', flag: '🇧🇷', ready: false },
];
const LOCALE_BY_CODE = Object.fromEntries(LOCALES.map(l => [l.code, l]));

/* Top-GEO badge on each brand card — flag + lang code + share, with a tooltip
   listing the top-5 geo breakdown so the user understands the targeting. */
function TopGeoBadge({ top_geo, top_lang, geo_breakdown }) {
  if (!top_geo && !top_lang) return null;
  const breakdown = Array.isArray(geo_breakdown) ? geo_breakdown : [];
  const topShare = breakdown[0]?.share;
  const tooltip = breakdown.length
    ? breakdown.map(b => `${b.geo}: ${Math.round((b.share || 0) * 100)}% (${b.n})`).join('\n')
    : '';
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-gray-800/60 text-gray-300 border border-gray-700/50 cursor-help"
    >
      {top_geo && <span className="text-sm leading-none">{geoFlag(top_geo)}</span>}
      <span className="font-mono">{top_geo || '??'}</span>
      {top_lang && <span className="text-gray-500">·</span>}
      {top_lang && <span className="text-gray-400">{top_lang}</span>}
      {topShare != null && breakdown.length > 1 && (
        <span className="text-gray-600">{Math.round(topShare * 100)}%</span>
      )}
    </span>
  );
}

/* Split-button: primary action generates in the suggested locale; the
   dropdown caret reveals all V1 locales. Non-EN options are disabled
   with a "(soon)" tag until Phase 2 wires the translation pipeline. */
function GenerateSplitButton({ suggested, isGenerating, onGenerate, onLocaleNotReady }) {
  const [open, setOpen] = useState(false);
  const suggestedLocale = LOCALE_BY_CODE[suggested] || LOCALE_BY_CODE.en;
  const primaryLabel = suggestedLocale.ready
    ? `Generate in ${suggestedLocale.label}`
    : 'Generate Review'; // suggested is non-EN but we can't ship it yet → label generically and fall through to EN

  const handlePrimary = () => {
    if (suggestedLocale.ready) {
      onGenerate(suggestedLocale.code);
    } else {
      // Suggested locale isn't ready yet → notify and fall back to EN
      onLocaleNotReady(suggestedLocale.code);
      onGenerate('en');
    }
  };

  return (
    <div className="relative inline-flex items-stretch shrink-0">
      <button
        onClick={handlePrimary}
        disabled={isGenerating}
        className="text-xs font-semibold text-red-400 hover:text-red-300 px-4 py-2 rounded-l-lg bg-red-600/10 hover:bg-red-600/20 border border-r-0 border-red-600/20 transition disabled:opacity-50"
      >
        {isGenerating ? (
          <span className="flex items-center gap-1.5">
            <span className="animate-spin">⟳</span> Generating...
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span>{suggestedLocale.flag}</span>
            <span>{primaryLabel}</span>
          </span>
        )}
      </button>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isGenerating}
        aria-label="Pick a language"
        className="text-xs text-red-400 hover:text-red-300 px-2 py-2 rounded-r-lg bg-red-600/10 hover:bg-red-600/20 border border-red-600/20 transition disabled:opacity-50"
      >
        ▾
      </button>

      {open && (
        <>
          {/* Click-outside catcher */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-dark-card border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
            {LOCALES.map(loc => (
              <button
                key={loc.code}
                onClick={() => {
                  setOpen(false);
                  if (loc.ready) {
                    onGenerate(loc.code);
                  } else {
                    onLocaleNotReady(loc.code);
                  }
                }}
                disabled={!loc.ready}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition ${
                  loc.ready
                    ? 'text-gray-200 hover:bg-white/5'
                    : 'text-gray-600 cursor-not-allowed'
                } ${loc.code === suggested ? 'bg-white/5' : ''}`}
              >
                <span className="text-base">{loc.flag}</span>
                <span className="flex-1">{loc.label}</span>
                {loc.code === suggested && <span className="text-[10px] text-amber-400">suggested</span>}
                {!loc.ready && <span className="text-[10px] text-gray-600">soon</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */
/*  MAIN PAGE                                            */
/* ═══════════════════════════════════════════════════════ */
export default function BrandsPage() {
  const { token } = useAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── Stats state ───
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // ─── Brands state ───
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  // Debounced copy of `search` used for server-side ?q= — keeps typing snappy
  // but avoids firing a fetch on every keystroke.
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('creative_volume');
  const [trendFilter, setTrendFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState(
    searchParams.get('filter') === 'no-review' ? 'none' : 'all'
  );

  // Debounce search → searchQuery (300ms)
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [generatingId, setGeneratingId] = useState(null);
  const [pendingReviewId, setPendingReviewId] = useState(null);
  const [toast, setToast] = useState(null);
  const [showStats, setShowStats] = useState(true);

  // SSE-driven progress for phase-A /generate (the split pipeline's first leg).
  const genProgress = useGenerateWithProgress(token);

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    if (type !== 'error') setTimeout(() => setToast(null), 3000);
  };

  // Navigate to the editor once phase A is done — the editor will auto-fire /polish.
  useEffect(() => {
    if (genProgress.step === 'done' && pendingReviewId && !genProgress.error) {
      router.push(`/admin/review/${pendingReviewId}?polish=auto`);
    }
  }, [genProgress.step, genProgress.error, pendingReviewId, router]);

  // ─── Fetch stats ───
  useEffect(() => {
    if (!token) return;
    setStatsLoading(true);
    fetch('/api/admin/funnel-stats', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStats(data); })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [token]);

  // ─── Fetch brands ───
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
      // Server-side name search — hits Supabase ilike on scam_brands.name.
      // Falls back to no filter when empty so the default listing is fast.
      if (searchQuery) params.set('q', searchQuery);
      const res = await fetch(`/api/admin/brands?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const results = data.brands || [];

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
  }, [token, sortBy, trendFilter, reviewFilter, searchQuery]);

  useEffect(() => {
    setPage(1);
    fetchBrands(1);
  }, [fetchBrands]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchBrands(next, true);
  };

  // Phase 0: `locale` is accepted but only 'en' actually runs the pipeline.
  // Stored alongside the create request so when Phase 2 wires translations,
  // the API can route the right way without changing this call-site.
  const handleOneClickGenerate = async (brandId, locale = 'en') => {
    setGeneratingId(brandId);
    setPendingReviewId(null);
    try {
      const createRes = await fetch('/api/admin/reviews/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_id: brandId, locale }),
      });

      if (!createRes.ok) throw new Error('Create failed');
      const { review_id } = await createRes.json();
      setPendingReviewId(review_id);

      // Kick off phase A and let the overlay stream progress. The useEffect above
      // navigates to the editor once the SSE stream emits step='done'.
      await genProgress.generate(brandId);
    } catch (err) {
      console.error('Generate error:', err);
      showToast('Error creating review: ' + (err.message || 'unknown'));
    } finally {
      setGeneratingId(null);
    }
  };

  // Friendly toast when user picks a locale that isn't ready yet (V1 = anything
  // other than EN). Tells them what's coming without blocking the flow.
  const handleLocaleNotReady = (locale) => {
    const label = LOCALE_BY_CODE[locale]?.label || locale;
    showToast(`${label} reviews ship in Phase 2 — generating in English for now`, 'warning');
  };

  const handleProgressClose = () => {
    genProgress.reset();
    setPendingReviewId(null);
  };

  return (
    <div className="space-y-6">
      {/* ─── Page Header ─── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Funnels</h1>
          <p className="text-gray-500 text-sm mt-1">
            {total > 0 ? `${total.toLocaleString()} scam funnels tracked` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={() => setShowStats(!showStats)}
          className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg border border-gray-800 hover:border-gray-700 transition"
        >
          {showStats ? 'Hide Stats' : 'Show Stats'}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/*  STATS DASHBOARD                               */}
      {/* ═══════════════════════════════════════════════ */}
      {showStats && (
        <div className="space-y-4">
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-dark-card border border-gray-800 rounded-xl px-4 py-3 animate-pulse">
                  <div className="h-3 bg-gray-800 rounded w-16 mb-2" />
                  <div className="h-7 bg-gray-800 rounded w-20" />
                </div>
              ))}
            </div>
          ) : stats ? (
            <>
              {/* Row 1: Key metrics */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard
                  label="Total Creatives"
                  value={fmt(stats.overview.total_creatives)}
                  sub={`${fmt(stats.overview.total_api || stats.last_scrape?.total_api)} on SpyOwl`}
                  accent="text-white"
                />
                <StatCard
                  label="Total Funnels"
                  value={fmt(stats.overview.total_brands)}
                  sub={`${fmt(stats.overview.active_brands)} active`}
                  accent="text-white"
                />
                <StatCard
                  label="Weekly Velocity"
                  value={fmt(stats.overview.total_velocity)}
                  sub="new ads / week"
                  accent="text-orange-400"
                />
                <StatCard
                  label="Countries"
                  value={stats.overview.unique_geos}
                  sub="targeted by scams"
                  accent="text-blue-400"
                />
                <StatCard
                  label="Celebrities"
                  value={fmt(stats.overview.unique_celebrities)}
                  sub="exploited in ads"
                  accent="text-amber-400"
                />
                <StatCard
                  label="Reviews"
                  value={`${stats.reviews.published}/${stats.reviews.total}`}
                  sub={`${stats.overview.review_coverage}% coverage`}
                  accent="text-green-400"
                />
              </div>

              {/* Row 2: Trend breakdown + Top geos + Scrape history */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Trend Breakdown */}
                <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">Trend Breakdown</h3>
                  <div className="space-y-1.5">
                    {['surging', 'rising', 'stable', 'declining', 'dead'].map(t => (
                      <TrendPill key={t} trend={t} count={stats.trends.counts[t]} ads={stats.trends.ads[t]} />
                    ))}
                  </div>
                </div>

                {/* Top Geos */}
                <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">Top Targeted Countries</h3>
                  <div className="space-y-1.5">
                    {(stats.top_geos || []).slice(0, 8).map((g, i) => (
                      <div key={g.geo} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-600 text-xs w-4">{i + 1}.</span>
                          <span className="text-base">{geoFlag(g.geo)}</span>
                          <span className="text-gray-300">{g.geo}</span>
                        </div>
                        <span className="text-gray-500 text-xs">{fmt(g.count)} funnels</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scrape History */}
                <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-2">Recent Scrapes</h3>
                  {stats.last_scrape && (
                    <p className="text-[11px] text-gray-600 mb-2">
                      Last: {timeAgo(stats.last_scrape.finished_at)} · {fmt(stats.last_scrape.creatives_synced)} synced
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {(stats.scrape_history || []).slice(0, 7).map(run => (
                      <ScrapeRow key={run.id} run={run} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 3: Threat levels bar */}
              <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">Threat Distribution</h3>
                <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-gray-800">
                  {stats.overview.total_brands > 0 && (
                    <>
                      <div
                        className="bg-red-500 rounded-l-full transition-all"
                        style={{ width: `${(stats.threat_levels.high / stats.overview.total_brands) * 100}%` }}
                        title={`High threat: ${stats.threat_levels.high}`}
                      />
                      <div
                        className="bg-amber-500 transition-all"
                        style={{ width: `${(stats.threat_levels.medium / stats.overview.total_brands) * 100}%` }}
                        title={`Medium threat: ${stats.threat_levels.medium}`}
                      />
                      <div
                        className="bg-green-500 rounded-r-full transition-all"
                        style={{ width: `${(stats.threat_levels.low / stats.overview.total_brands) * 100}%` }}
                        title={`Low threat: ${stats.threat_levels.low}`}
                      />
                    </>
                  )}
                </div>
                <div className="flex items-center gap-6 mt-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-400">High ({fmt(stats.threat_levels.high)})</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-gray-400">Medium ({fmt(stats.threat_levels.medium)})</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-400">Low ({fmt(stats.threat_levels.low)})</span>
                  </span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/*  FILTERS BAR                                   */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands..."
            className="search-input w-full text-sm py-2"
          />
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="search-input text-sm py-2 w-auto"
        >
          <option value="creative_volume">Most Ads</option>
          <option value="velocity">Most Active</option>
          <option value="scam_score">Highest Score</option>
        </select>

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

      {/* ═══════════════════════════════════════════════ */}
      {/*  BRANDS LIST                                   */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="space-y-2">
        {brands.map((brand) => (
          <div
            key={brand.id}
            className={`bg-dark-card border rounded-xl px-5 py-4 flex items-center gap-4 transition hover:border-gray-700 ${
              !brand.review_status && brand.total_creatives > 50
                ? 'border-amber-600/30'
                : 'border-gray-800'
            }`}
          >
            <ScamScoreChip score={brand.scam_score} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-semibold text-sm truncate">{brand.name}</span>
                <TrendBadge trend={brand.trend} />
                <TopGeoBadge
                  top_geo={brand.top_geo}
                  top_lang={brand.top_lang}
                  geo_breakdown={brand.geo_breakdown}
                />
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
                <GenerateSplitButton
                  suggested={brand.suggested_locale || 'en'}
                  isGenerating={generatingId === brand.id}
                  onGenerate={(locale) => handleOneClickGenerate(brand.id, locale)}
                  onLocaleNotReady={handleLocaleNotReady}
                />
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
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-2">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl max-w-sm ${
            toast.type === 'error' ? 'bg-red-950/90 border-red-600/30 text-red-300' :
            toast.type === 'warning' ? 'bg-amber-950/90 border-amber-600/30 text-amber-300' :
            'bg-green-950/90 border-green-600/30 text-green-300'
          }`}>
            <span className="text-sm flex-1">{toast.msg}</span>
            <button onClick={() => setToast(null)} className="text-current opacity-60 hover:opacity-100 text-lg leading-none shrink-0">&times;</button>
          </div>
        </div>
      )}

      {(genProgress.isGenerating || genProgress.step === 'done' || genProgress.error) && (
        <GenerateProgressOverlay
          progress={genProgress.progress}
          step={genProgress.step}
          message={genProgress.message}
          error={genProgress.error}
          onClose={handleProgressClose}
        />
      )}
    </div>
  );
}
