'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/* ─── Reusable Cards ─── */
function StatCard({ label, value, sub, color = 'gray', icon }) {
  const colors = {
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    gray: 'bg-gray-800/50 border-gray-700/40 text-gray-300',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider opacity-70">{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-xs opacity-60 mt-1">{sub}</div>}
    </div>
  );
}
function SectionHeader({ title, sub }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {sub && <p className="text-gray-500 text-sm mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── Ingestion Sparkline (14-day bar chart) ─── */
function IngestionChart({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.brands), 1);
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5">
      <SectionHeader title="Ingestion Trend" sub="New funnels discovered per day (14 days)" />
      <div className="flex items-end gap-1 h-32">
        {data.map((d, i) => {
          const pct = (d.brands / max) * 100;
          const isToday = i === data.length - 1;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.brands}`}>
              <span className="text-[10px] text-gray-500">{d.brands > 0 ? d.brands : ''}</span>
              <div className="w-full rounded-t" style={{
                height: `${Math.max(pct, 2)}%`,
                backgroundColor: isToday ? '#ef4444' : d.brands > 0 ? '#3b82f6' : '#1f2937',
                minHeight: '2px',
              }} />              <span className="text-[9px] text-gray-600">
                {new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── SpyOwl Connection Banner ─── */
function SpyOwlBanner({ spyowl }) {
  if (!spyowl) return null;
  const isOld = spyowl.cookie_age_hours && spyowl.cookie_age_hours > 48;
  return (
    <div className={`rounded-xl border px-5 py-4 flex items-center justify-between ${
      spyowl.connected
        ? isOld
          ? 'bg-amber-500/5 border-amber-500/20'
          : 'bg-green-500/5 border-green-500/20'
        : 'bg-red-500/10 border-red-500/30'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${
          spyowl.connected ? (isOld ? 'bg-amber-400' : 'bg-green-400 animate-pulse') : 'bg-red-500'
        }`} />
        <div>
          <span className={`text-sm font-medium ${
            spyowl.connected ? (isOld ? 'text-amber-300' : 'text-green-300') : 'text-red-400'
          }`}>            SpyOwl {spyowl.connected ? 'Connected' : 'Disconnected'}
          </span>
          {spyowl.connected && spyowl.cookie_age_hours !== null && (
            <span className="text-xs text-gray-500 ml-2">
              Cookie age: {spyowl.cookie_age_hours}h
              {isOld && ' — refresh soon'}
            </span>
          )}
          {!spyowl.connected && (
            <span className="text-xs text-red-400/70 ml-2">Scraping paused — cookie expired</span>
          )}
        </div>
      </div>
      <Link href="/admin/settings" className="text-xs font-medium text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition">
        {spyowl.connected ? 'Refresh Cookie' : 'Fix Connection'}
      </Link>
    </div>
  );
}

/* ─── Top Surging Table ─── */
function SurgingTable({ brands }) {
  if (!brands || brands.length === 0) {
    return <div className="text-gray-600 text-sm py-6 text-center">No surging funnels detected</div>;
  }
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <SectionHeader title="Surging Funnels" sub="Highest velocity — prime SEO targets" />
      </div>
      <div className="overflow-x-auto">        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800/60">
              <th className="text-left px-5 py-2">Funnel</th>
              <th className="text-right px-3 py-2">Vel/wk</th>
              <th className="text-right px-3 py-2">Ads</th>
              <th className="text-right px-3 py-2">Score</th>
              <th className="text-right px-3 py-2">Geos</th>
              <th className="text-right px-5 py-2">Celebs</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.id} className="border-b border-gray-800/30 hover:bg-white/[0.02] transition">
                <td className="px-5 py-3">
                  <Link href={`/admin/brands`} className="text-white font-medium hover:text-red-400 transition">
                    {b.name}
                  </Link>
                </td>
                <td className="text-right px-3 py-3 text-red-400 font-bold">{b.velocity_7d}</td>
                <td className="text-right px-3 py-3 text-gray-400">{b.total_creatives?.toLocaleString()}</td>
                <td className="text-right px-3 py-3">
                  <span className={`font-bold ${b.scam_score >= 80 ? 'text-red-400' : b.scam_score >= 60 ? 'text-amber-400' : 'text-gray-400'}`}>
                    {b.scam_score}
                  </span>
                </td>
                <td className="text-right px-3 py-3 text-gray-400">{b.total_geos}</td>
                <td className="text-right px-5 py-3 text-amber-400">{b.total_celebrities || '—'}</td>
              </tr>
            ))}          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Recently Discovered ─── */
function RecentlyDiscovered({ brands }) {
  if (!brands || brands.length === 0) return null;
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5">
      <SectionHeader title="Recently Discovered" sub="Latest funnels entering the pipeline" />
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {brands.map((b) => (
          <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-800/30 last:border-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold ${
                b.scam_score >= 70 ? 'text-red-400 bg-red-500/10' : b.scam_score >= 50 ? 'text-amber-400 bg-amber-500/10' : 'text-gray-400 bg-gray-500/10'
              }`}>
                {b.scam_score || '?'}
              </span>
              <span className="text-sm text-white truncate">{b.name}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="text-xs text-gray-500">{b.total_creatives} ads</span>
              <span className="text-xs text-gray-600">
                {b.created_at ? new Date(b.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'}
              </span>
            </div>
          </div>
        ))}      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function ScraperPage() {
  const { token } = useAdmin();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/scraper', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          Loading scraper intelligence...
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-3">Failed to load scraper data</p>
        <button onClick={fetchData} className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 transition">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { spyowl, ingestion, activity, quality } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Scraper Control</h1>
          <p className="text-gray-500 text-sm mt-1">SpyOwl ingestion pipeline &amp; data intelligence</p>
        </div>
        <button
          onClick={fetchData}
          className="text-xs font-medium text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition"
        >
          Refresh
        </button>
      </div>

      {/* SpyOwl Connection Status */}
      <SpyOwlBanner spyowl={spyowl} />
      {/* KPI Row 1: Pipeline Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Funnels" value={data.total_brands} color="blue" icon="🎯" />
        <StatCard label="Total Creatives" value={data.total_creatives} color="purple" icon="🖼" />
        <StatCard label="Avg Ads/Funnel" value={data.avg_creatives_per_brand} color="gray" icon="📊" />
        <StatCard
          label="Last Creative"
          value={ingestion.last_creative_at ? timeAgo(ingestion.last_creative_at) : 'N/A'}
          color={ingestion.last_creative_at && isStale(ingestion.last_creative_at) ? 'red' : 'green'}
          icon="⏱"
        />
      </div>

      {/* KPI Row 2: Ingestion Velocity */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="New (24h)" value={ingestion.last_24h} sub="funnels discovered" color={ingestion.last_24h > 0 ? 'green' : 'red'} />
        <StatCard label="New (7d)" value={ingestion.last_7d} sub="funnels discovered" color="blue" />
        <StatCard label="New (30d)" value={ingestion.last_30d} sub="funnels discovered" color="gray" />
      </div>

      {/* Ingestion Chart */}
      <IngestionChart data={ingestion.daily_trend} />

      {/* KPI Row 3: Campaign Activity */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Active" value={activity.active} color="green" />
        <StatCard label="Surging" value={activity.surging} color="red" />
        <StatCard label="Rising" value={activity.rising} color="amber" />
        <StatCard label="Stale" value={activity.stale} sub="active but no recent data" color="amber" />
        <StatCard label="Dead" value={activity.dead} color="gray" />      </div>

      {/* KPI Row 4: Data Quality / SEO Intel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="High Score (80+)" value={quality.high_score} sub="critical threat funnels" color="red" />
        <StatCard label="Unscored" value={quality.unscored} sub="need scoring" color={quality.unscored > 0 ? 'amber' : 'green'} />
        <StatCard label="Celebrity Funnels" value={quality.with_celebrities} sub={`${quality.total_celeb_mentions} total mentions`} color="purple" />
        <StatCard label="Geo Entries" value={quality.total_geo_entries} sub="country targeting data" color="blue" />
      </div>

      {/* Two-column: Surging + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SurgingTable brands={data.top_surging} />
        <RecentlyDiscovered brands={data.recently_discovered} />
      </div>
    </div>
  );
}

/* ─── Helpers ─── */
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(dateStr) {
  return Date.now() - new Date(dateStr).getTime() > 24 * 3600000;
}