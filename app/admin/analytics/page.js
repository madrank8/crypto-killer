'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';

/* ═══════════════════════ shared primitives ═══════════════════════ */

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1000).toFixed(1) + 'k';
  return n.toLocaleString();
}

function DeltaChip({ current, previous }) {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-green-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function StatCard({ label, value, prev, sub }) {
  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <div className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{fmt(value)}</span>
        <DeltaChip current={value} previous={prev} />
      </div>
      {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
    </div>
  );
}

/* Dependency-free SVG area/line chart */
function LineChart({ data, series, height = 180 }) {
  if (!data || data.length === 0) {
    return <div className="h-[180px] flex items-center justify-center text-gray-600 text-sm">No data yet</div>;
  }
  const W = 800;
  const H = height;
  const PAD = { top: 10, right: 10, bottom: 22, left: 42 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const x = (i) => PAD.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => PAD.top + ih - (v / max) * ih;

  const pathOf = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key] || 0).toFixed(1)}`).join(' ');
  const areaOf = (key) => `${pathOf(key)} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#1f2937" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#6b7280">{fmt(t)}</text>
          </g>
        ))}
        {series.map((s, si) => (
          <g key={s.key}>
            {si === 0 && <path d={areaOf(s.key)} fill={s.color} opacity="0.12" />}
            <path d={pathOf(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
          </g>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#6b7280">
              {(d.day || d.date || d.week || '').slice(5)}
            </text>
          ) : null
        )}
      </svg>
      <div className="flex gap-4 mt-2">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* Horizontal bar list (top pages / referrers / etc.) */
function BarList({ title, rows, valueKey = 'pageviews', valueLabel = 'views', keyFormat }) {
  const max = Math.max(1, ...(rows || []).map((r) => r[valueKey] || 0));
  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {!rows || rows.length === 0 ? (
        <p className="text-gray-600 text-sm">No data yet</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="relative">
              <div
                className="absolute inset-y-0 left-0 bg-blue-500/10 rounded"
                style={{ width: `${((r[valueKey] || 0) / max) * 100}%` }}
              />
              <div className="relative flex justify-between items-center px-2 py-1 text-sm">
                <span className="text-gray-300 truncate mr-3" title={r.key || r.target}>
                  {keyFormat ? keyFormat(r) : (r.key || r.target)}
                </span>
                <span className="text-gray-400 font-medium tabular-nums shrink-0">
                  {fmt(r[valueKey])} <span className="text-gray-600 text-xs">{valueLabel}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RangePicker({ value, onChange, options }) {
  return (
    <div className="flex gap-1 bg-dark-card border border-gray-800 rounded-lg p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition ${
            value === o ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          {o}d
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════ Traffic tab ═══════════════════════ */

function TrafficTab({ token }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/admin/analytics/traffic?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.error || 'Failed to load'));
    return () => { alive = false; };
  }, [days, token]);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!data) return <TabSkeleton />;

  const cur = data.summary?.current || {};
  const prev = data.summary?.previous || {};
  const noTraffic = (cur.pageviews || 0) === 0 && (prev.pageviews || 0) === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-gray-500 text-sm">First-party events from cryptokiller.org — no cookies, daily-rotating visitor hash.</p>
        <RangePicker value={days} onChange={setDays} options={[7, 30, 90]} />
      </div>

      {noTraffic && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-300">
          No events recorded yet. The tracker snippet must be installed on the Replit production site —
          see <code className="text-amber-200">docs/REPLIT_ANALYTICS_TRACKER_HANDOFF.md</code> (one script tag).
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Pageviews" value={cur.pageviews} prev={prev.pageviews} />
        <StatCard label="Visitors" value={cur.visitors} prev={prev.visitors} />
        <StatCard label="Sessions" value={cur.sessions} prev={prev.sessions} />
        <StatCard label="Outbound Clicks" value={cur.clicks} prev={prev.clicks} sub="CTA / affiliate links" />
      </div>

      <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Traffic over time</h3>
        <LineChart
          data={data.timeseries}
          series={[
            { key: 'pageviews', label: 'Pageviews', color: '#3b82f6' },
            { key: 'visitors', label: 'Visitors', color: '#22c55e' },
          ]}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <BarList title="Top Pages" rows={data.top?.pages} />
        <BarList title="Referrers" rows={data.top?.referrers} />
        <BarList title="Countries" rows={data.top?.countries} />
        <BarList
          title="Top Outbound Clicks"
          rows={data.top?.clicks}
          valueKey="clicks"
          valueLabel="clicks"
          keyFormat={(r) => r.target}
        />
        <BarList title="Devices" rows={data.top?.devices} />
        <BarList title="Locales" rows={data.top?.locales} />
      </div>
    </div>
  );
}

/* ═══════════════════════ Search tab ═══════════════════════ */

function SearchTab({ token }) {
  const [days, setDays] = useState(28);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/admin/analytics/search?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.error || 'Failed to load'));
    return () => { alive = false; };
  }, [days, token]);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!data) return <TabSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-gray-500 text-sm">Google Search Console — synced daily at 06:30 UTC.</p>
        <RangePicker value={days} onChange={setDays} options={[7, 28, 90]} />
      </div>

      {!data.configured && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-300">
          GSC is not connected yet. Set <code className="text-amber-200">GSC_CLIENT_EMAIL</code>,{' '}
          <code className="text-amber-200">GSC_PRIVATE_KEY</code> and{' '}
          <code className="text-amber-200">GSC_SITE_URL</code> in Vercel —
          full walkthrough in <code className="text-amber-200">docs/GSC_SETUP.md</code>.
        </div>
      )}
      {data.configured && !data.hasData && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-300">
          GSC connected, waiting for first sync. Trigger manually:{' '}
          <code className="text-blue-200">curl -H &quot;Authorization: Bearer $ADMIN_SECRET&quot; /api/cron/gsc-sync</code>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Clicks" value={data.totals?.clicks} />
        <StatCard label="Impressions" value={data.totals?.impressions} />
        <StatCard
          label="CTR"
          value={data.totals?.impressions ? +(data.totals.ctr * 100).toFixed(1) : null}
          sub="percent"
        />
      </div>

      <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Clicks & impressions</h3>
        <LineChart
          data={data.timeseries}
          series={[
            { key: 'impressions', label: 'Impressions', color: '#8b5cf6' },
            { key: 'clicks', label: 'Clicks', color: '#22c55e' },
          ]}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <BarList title="Top Pages (by clicks)" rows={data.topPages} valueKey="clicks" valueLabel="clicks" />
        <BarList title="Top Queries (by clicks)" rows={data.topQueries} valueKey="clicks" valueLabel="clicks" />
      </div>
    </div>
  );
}

/* ═══════════════════════ Content Ops tab ═══════════════════════ */

function StatusPills({ title, counts }) {
  const COLORS = {
    published: 'bg-green-500/15 text-green-400 border-green-500/30',
    draft: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    complete: 'bg-green-500/15 text-green-400 border-green-500/30',
    error: 'bg-red-500/15 text-red-400 border-red-500/30',
    failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {Object.entries(counts || {}).map(([k, v]) => (
          <span
            key={k}
            className={`px-2.5 py-1 rounded-full border text-xs font-medium ${COLORS[k] || 'bg-gray-500/10 text-gray-400 border-gray-700'}`}
          >
            {k}: {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContentOpsTab({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/analytics/content-ops', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.error || 'Failed to load'));
    return () => { alive = false; };
  }, [token]);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!data) return <TabSkeleton />;

  const t = data.totals || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Published Reviews" value={t.publishedReviews} sub={`${t.reviews} total`} />
        <StatCard label="Published Articles" value={t.publishedArticles} sub={`${t.articles} total`} />
        <StatCard label="Translations" value={t.translations} />
        <StatCard label="Words Published" value={(t.reviewWords || 0) + (t.articleWords || 0)} sub="reviews + articles" />
      </div>

      <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Publish velocity (per ISO week, trailing 12)</h3>
        <LineChart
          data={data.publishVelocity}
          series={[
            { key: 'reviews', label: 'Reviews', color: '#3b82f6' },
            { key: 'articles', label: 'Articles', color: '#f59e0b' },
          ]}
          height={150}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <StatusPills title="Review Pipeline" counts={data.pipeline?.reviews} />
        <StatusPills title="Article Pipeline" counts={data.pipeline?.content} />
      </div>

      {/* Translation coverage */}
      <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Translation coverage per locale</h3>
        {(data.translationCoverage || []).length === 0 ? (
          <p className="text-gray-600 text-sm">No translations yet</p>
        ) : (
          <div className="space-y-2.5">
            {data.translationCoverage.map((l) => (
              <div key={l.locale}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-300 font-medium uppercase">{l.locale}</span>
                  <span className="text-gray-500">
                    {l.published}/{l.masters} published ({Math.round(l.coverage * 100)}%)
                  </span>
                </div>
                <div className="h-2 bg-dark-bg border border-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 transition-all" style={{ width: `${Math.min(100, l.coverage * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Maintenance engine queue */}
      {data.maintenanceQueue && Object.keys(data.maintenanceQueue.counts || {}).length > 0 && (
        <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">🤖 Maintenance Engine — regeneration queue</h3>
            <div className="flex gap-2">
              {Object.entries(data.maintenanceQueue.counts).map(([k, v]) => (
                <span key={k} className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${
                  k === 'published' ? 'bg-green-500/15 text-green-400 border-green-500/30'
                  : k === 'needs_review' || k === 'failed' ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : k === 'generating' || k === 'polishing' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                  : 'bg-gray-500/10 text-gray-400 border-gray-700'
                }`}>{k}: {v}</span>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {(data.maintenanceQueue.items || []).map((q) => (
              <div key={q.slug} className="flex justify-between items-center text-sm">
                <span className="text-gray-300 truncate mr-3">
                  <span className="text-gray-600 mr-2">#{q.priority}</span>{q.slug}
                  {q.note && <span className="text-gray-600 text-xs ml-2">{q.note}</span>}
                </span>
                <span className={`shrink-0 text-xs font-medium ${
                  q.status === 'needs_review' || q.status === 'failed' ? 'text-red-400'
                  : q.status === 'generating' || q.status === 'polishing' ? 'text-blue-400'
                  : 'text-gray-500'
                }`} title={q.last_error || ''}>{q.status}{q.attempts > 0 ? ` (retry ${q.attempts})` : ''}</span>
              </div>
            ))}
          </div>
          {(data.maintenanceQueue.recentPublished || []).length > 0 && (
            <p className="text-xs text-gray-600 mt-3">
              Recently auto-published: {data.maintenanceQueue.recentPublished.map((q) => q.slug).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Staleness */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Stalest published reviews</h3>
          <div className="space-y-1.5">
            {(data.staleness || []).map((r) => (
              <div key={r.slug} className="flex justify-between text-sm">
                <span className="text-gray-300 truncate mr-3" title={r.title}>{r.slug}</span>
                <span className={`shrink-0 tabular-nums ${r.ageDays > 90 ? 'text-red-400' : r.ageDays > 30 ? 'text-amber-400' : 'text-gray-500'}`}>
                  {r.ageDays}d
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Scraper health */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Scraper runs (last 20)</h3>
          <div className="space-y-1.5">
            {(data.scraper || []).map((r, i) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <span className="text-gray-400">{new Date(r.started_at).toLocaleDateString()} <span className="text-gray-600 text-xs">{r.trigger_type}</span></span>
                <span className="flex items-center gap-3">
                  <span className="text-gray-500 text-xs tabular-nums">+{fmt(r.new_creatives)} new</span>
                  <span className={`w-2 h-2 rounded-full ${r.status === 'complete' || r.status === 'completed' || r.status === 'success' ? 'bg-green-500' : r.status === 'running' ? 'bg-blue-500' : 'bg-red-500'}`} title={r.status} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════ Advisor tab ═══════════════════════ */

const PRIORITY_STYLES = {
  P0: 'bg-red-500/15 text-red-400 border-red-500/30',
  P1: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  P2: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};
const SEVERITY_DOT = { info: 'bg-blue-500', warn: 'bg-amber-500', critical: 'bg-red-500' };
const TREND_ARROW = { up: '↗', down: '↘', flat: '→' };

function HealthDial({ score }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  const C = 2 * Math.PI * 26;
  return (
    <div className="relative w-16 h-16">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r="26" fill="none" stroke="#1f2937" strokeWidth="6" />
        <circle
          cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">{score}</span>
    </div>
  );
}

const EXECUTABLE = new Set(['new_review', 'refresh_review', 'fix_ctr']);
const EXECUTE_LABELS = {
  new_review: '⚡ Create & generate review',
  refresh_review: '⚡ Run polish',
  fix_ctr: '⚡ Run polish + SEO fix',
};

function SuggestionCard({ s, state, onSetState, onExecute, executing }) {
  const muted = state === 'done' || state === 'dismissed';
  const canExecute = EXECUTABLE.has(s.action_type);
  return (
    <div className={`bg-dark-card border rounded-xl p-4 ${muted ? 'border-gray-800/50 opacity-50' : 'border-gray-800'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${PRIORITY_STYLES[s.priority]}`}>{s.priority}</span>
          <span className="text-[11px] text-gray-500 uppercase tracking-wide">{s.impact} impact · {s.effort}</span>
        </div>
        <div className="flex gap-1 shrink-0">
          {muted ? (
            <button onClick={() => onSetState(s.fingerprint, null)} className="text-xs text-gray-500 hover:text-white px-2 py-1">
              {state === 'done' ? '✓ done' : 'dismissed'} · undo
            </button>
          ) : (
            <>
              <button onClick={() => onSetState(s.fingerprint, 'done')} title="Mark done"
                className="text-xs text-gray-500 hover:text-green-400 px-1.5 py-1">✓</button>
              <button onClick={() => onSetState(s.fingerprint, 'dismissed')} title="Dismiss"
                className="text-xs text-gray-500 hover:text-red-400 px-1.5 py-1">✕</button>
            </>
          )}
        </div>
      </div>
      <h4 className={`font-semibold mt-2 ${muted ? 'text-gray-500 line-through' : 'text-white'}`}>{s.title}</h4>
      <p className="text-sm text-gray-400 mt-1.5">{s.why}</p>
      {!muted && (
        <div className="flex items-center gap-4 mt-3">
          {canExecute && (
            <button
              onClick={() => onExecute(s)}
              disabled={executing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition"
            >
              {executing === s.fingerprint ? 'Starting…' : EXECUTE_LABELS[s.action_type]}
            </button>
          )}
          {s.deep_link && (
            <a href={s.deep_link}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300">
              Open {s.target ? <code className="text-xs bg-dark-bg px-1.5 py-0.5 rounded">{s.target}</code> : null} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function AdvisorTab({ token }) {
  const [reports, setReports] = useState(null);
  const [states, setStates] = useState({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    fetch('/api/admin/advisor/reports?limit=10', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then((d) => {
        setReports(d.reports || []);
        setStates(d.states || {});
        setActiveIdx(0);
      })
      .catch((e) => setError(e.error || 'Failed to load'));
  };
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (force = false) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/advisor/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (res.status === 429) {
        if (window.confirm('A report was generated in the last 30 minutes. Run again anyway?')) return run(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Run failed');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const [executing, setExecuting] = useState(null);
  const execute = async (s) => {
    setExecuting(s.fingerprint);
    setError(null);
    try {
      const res = await fetch('/api/admin/advisor/execute', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: s.fingerprint }),
      });
      const data = await res.json();
      if (!res.ok && !data.redirect) throw new Error(data.error || 'Execute failed');
      if (data.redirect) window.location.href = data.redirect;
    } catch (e) {
      setError(`Execute failed: ${e.message}`);
      setExecuting(null);
    }
  };

  const setState = async (fingerprint, state) => {
    setStates((prev) => {
      const next = { ...prev };
      if (state === null) delete next[fingerprint];
      else next[fingerprint] = state;
      return next;
    });
    fetch('/api/admin/advisor/suggestion', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint, state }),
    }).catch(() => {});
  };

  if (!reports) return <TabSkeleton />;

  const completed = reports.filter((r) => r.status === 'complete' && r.report);
  const active = completed[activeIdx];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          {active && <HealthDial score={active.report.health_score} />}
          <div>
            <h2 className="text-lg font-semibold text-white">AI Advisor</h2>
            {active ? (
              <p className="text-xs text-gray-500">
                {new Date(active.created_at).toLocaleString()} · {active.trigger_type} · {active.model} ·{' '}
                {active.report.suggestions.length} suggestions
              </p>
            ) : (
              <p className="text-xs text-gray-500">No reports yet</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {completed.length > 1 && (
            <select
              value={activeIdx}
              onChange={(e) => setActiveIdx(+e.target.value)}
              className="bg-dark-card border border-gray-800 rounded-lg text-xs text-gray-300 px-2 py-2"
            >
              {completed.map((r, i) => (
                <option key={r.id} value={i}>
                  {new Date(r.created_at).toLocaleDateString()} {i === 0 ? '(latest)' : ''}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => run(false)}
            disabled={running}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition"
          >
            {running ? 'Analyzing… (~30-60s)' : 'Analyze now'}
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!active && !running && (
        <div className="bg-dark-card border border-gray-800 rounded-xl p-10 text-center">
          <p className="text-gray-400 mb-2">The advisor reads your traffic, search and content data and returns prioritized, data-cited actions.</p>
          <p className="text-gray-600 text-sm">Click <span className="text-blue-400">Analyze now</span> to generate the first report. It also runs automatically every Monday.</p>
        </div>
      )}

      {active && (
        <>
          {/* Summary */}
          <div className="bg-dark-card border border-gray-800 rounded-xl p-5">
            <p className="text-gray-200 leading-relaxed">{active.report.summary}</p>
          </div>

          {/* Insights */}
          {active.report.insights.length > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              {active.report.insights.map((ins, i) => (
                <div key={i} className="bg-dark-card border border-gray-800 rounded-xl p-4 flex gap-3">
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[ins.severity]}`} />
                  <div>
                    <span className="text-sm font-medium text-white">{TREND_ARROW[ins.trend]} {ins.title}</span>
                    <p className="text-xs text-gray-500 mt-1">{ins.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions grouped by priority */}
          {['P0', 'P1', 'P2'].map((prio) => {
            const items = active.report.suggestions.filter((s) => s.priority === prio);
            if (items.length === 0) return null;
            return (
              <div key={prio}>
                <h3 className="text-sm font-semibold text-gray-400 mb-2">
                  {prio === 'P0' ? 'Do now' : prio === 'P1' ? 'This week' : 'When you can'}
                </h3>
                <div className="space-y-3">
                  {items.map((s) => (
                    <SuggestionCard key={s.fingerprint} s={s} state={states[s.fingerprint]} onSetState={setState}
                      onExecute={execute} executing={executing} />
                  ))}
                </div>
              </div>
            );
          })}

          <p className="text-xs text-gray-700">
            {active.tokens_in ? `${fmt(active.tokens_in)} in / ${fmt(active.tokens_out)} out tokens · ` : ''}
            period: {active.period_days}d
          </p>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════ page shell ═══════════════════════ */

function TabSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-dark-card border border-gray-800 rounded-xl h-24" />
        ))}
      </div>
      <div className="bg-dark-card border border-gray-800 rounded-xl h-56" />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-dark-card border border-gray-800 rounded-xl h-48" />
        <div className="bg-dark-card border border-gray-800 rounded-xl h-48" />
      </div>
    </div>
  );
}

const TABS = [
  { id: 'advisor', label: '✦ Advisor' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'search', label: 'Search' },
  { id: 'content-ops', label: 'Content Ops' },
];

export default function AnalyticsPage() {
  const { token, loading } = useAdmin();
  const [tab, setTab] = useState('advisor');

  if (loading) return <TabSkeleton />;
  if (!token) return <p className="text-gray-500 text-sm">Log in to view analytics.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Traffic, search performance and content operations</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'advisor' && <AdvisorTab token={token} />}
      {tab === 'traffic' && <TrafficTab token={token} />}
      {tab === 'search' && <SearchTab token={token} />}
      {tab === 'content-ops' && <ContentOpsTab token={token} />}
    </div>
  );
}
