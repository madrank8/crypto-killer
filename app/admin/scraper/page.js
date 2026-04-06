'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useCallback, Fragment } from 'react';
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
              }} />
              <span className="text-[9px] text-gray-600">
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
          }`}>
            SpyOwl {spyowl.connected ? 'Connected' : 'Disconnected'}
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
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
            ))}
          </tbody>
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
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCRAPE CONTROL PANEL
   ═══════════════════════════════════════════════════════════════ */

/* --- Live Elapsed Timer --- */
function LiveTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = n => String(n).padStart(2, '0');
  return (
    <span className="font-mono text-xl tabular-nums">
      {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`}
    </span>
  );
}

/* --- Scrape Pipeline Phases (matches lib/scraper.js progress phases) --- */
const SCRAPE_PHASES = [
  { id: 'initializing', label: 'Init', icon: '⚙' },
  { id: 'authenticating', label: 'Auth', icon: '🔑' },
  { id: 'scanning', label: 'Scraping', icon: '📡' },
  { id: 'processing', label: 'Brands', icon: '⚡' },
  { id: 'done', label: 'Done', icon: '✓' },
];

function formatStepTime(startTime, stepTime) {
  if (!startTime || !stepTime) return '';
  const diff = Math.floor((new Date(stepTime) - new Date(startTime)) / 1000);
  if (diff < 0) return '00:00';
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* --- Active Job Live Status Panel --- */
function ActiveJobPanel({ job, avgDuration }) {
  const progress = job.progress || {
    phase: job.status === 'pending' ? 'initializing' : 'scanning',
    steps: [], percent: 0, message: '',
  };
  const isFailed = progress.phase === 'failed' || job.status === 'failed';
  const isDone = progress.phase === 'done' || job.status === 'completed';
  const hasWarning = isDone && job.error_message;
  const currentPhaseIdx = isFailed
    ? SCRAPE_PHASES.length - 1
    : Math.max(0, SCRAPE_PHASES.findIndex(p => p.id === progress.phase));
  const phasePct = progress.percent || Math.round(((currentPhaseIdx + 0.5) / SCRAPE_PHASES.length) * 100);

  // Extract live counts from progress message (e.g., "Fetched 18,500 of 50,000 creatives...")
  const liveMatch = (progress.message || '').match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)/);
  const liveFetched = liveMatch ? liveMatch[1] : null;
  const liveTotal = liveMatch ? liveMatch[2] : null;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!job.started_at) return;
    const start = new Date(job.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [job.started_at]);
  const eta = avgDuration && avgDuration > 0 && elapsed < avgDuration * 1.5
    ? Math.max(0, Math.round(avgDuration - elapsed))
    : null;

  return (
    <div className={`border rounded-xl overflow-hidden mb-3 ${
      isFailed ? 'bg-gradient-to-br from-red-500/[0.07] via-red-500/[0.03] to-transparent border-red-500/20'
      : hasWarning ? 'bg-gradient-to-br from-amber-500/[0.07] via-amber-500/[0.03] to-transparent border-amber-500/20'
      : isDone ? 'bg-gradient-to-br from-green-500/[0.07] via-green-500/[0.03] to-transparent border-green-500/20'
      : 'bg-gradient-to-br from-blue-500/[0.07] via-blue-500/[0.03] to-transparent border-blue-500/20'
    }`}>
      {/* Header: status message + live timer */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            {isFailed ? (
              <div className="w-3 h-3 bg-red-500 rounded-full" />
            ) : isDone ? (
              <div className={`w-3 h-3 rounded-full ${hasWarning ? 'bg-amber-400' : 'bg-green-400'}`} />
            ) : (
              <>
                <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 bg-blue-400 rounded-full animate-ping opacity-20" />
              </>
            )}
          </div>
          <div className="min-w-0">
            <div className={`text-sm font-semibold truncate ${
              isFailed ? 'text-red-300' : hasWarning ? 'text-amber-200' : isDone ? 'text-green-200' : 'text-blue-200'
            }`}>
              {progress.message || (job.status === 'pending' ? 'Queued — waiting to start' : 'Scrape in progress')}
            </div>
            {job.error_message && (
              <div className="text-[11px] text-amber-400/80 mt-0.5 truncate">{job.error_message}</div>
            )}
            <div className="text-[11px] text-gray-500 mt-0.5">
              {job.trigger_type === 'scheduled' ? 'Scheduled (cron)' : 'Manual trigger'} • Job {job.id?.slice(0, 8)}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 ml-4">
          <LiveTimer startTime={job.started_at} />
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">{isDone || isFailed ? 'duration' : 'elapsed'}</div>
        </div>
      </div>

      {/* Phase timeline */}
      <div className="px-5 pb-3">
        <div className="flex items-center">
          {SCRAPE_PHASES.map((phase, i) => {
            const phaseIsDone = i < currentPhaseIdx || (isDone && i <= currentPhaseIdx);
            const phaseIsActive = i === currentPhaseIdx && !isDone && !isFailed;
            const phaseIsFailed = i === currentPhaseIdx && isFailed;
            const phaseHasWarning = phaseIsDone && hasWarning && i === currentPhaseIdx;
            return (
              <Fragment key={phase.id}>
                {i > 0 && (
                  <div className={`flex-1 h-px transition-colors duration-500 ${
                    phaseIsDone || (isDone && i <= currentPhaseIdx) ? (hasWarning ? 'bg-amber-400/60' : isFailed ? 'bg-red-400/60' : 'bg-green-400/60')
                    : phaseIsActive ? 'bg-blue-400/60'
                    : 'bg-gray-700/60'
                  }`} />
                )}
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all duration-300 ${
                    phaseIsFailed ? 'bg-red-500/20 text-red-400 ring-1 ring-red-400/40'
                    : phaseHasWarning ? 'bg-amber-500/10 text-amber-400'
                    : phaseIsDone ? 'bg-green-500/10 text-green-400'
                    : phaseIsActive ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40 shadow-sm shadow-blue-500/10'
                    : 'text-gray-600'
                  }`}
                  title={phase.label}
                >
                  <span className="text-xs">{
                    phaseIsFailed ? '✗'
                    : phaseHasWarning ? '!'
                    : phaseIsDone ? '✓'
                    : phaseIsActive ? phase.icon
                    : '○'
                  }</span>
                  <span className="hidden md:inline">{phase.label}</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-5 pb-3">
        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
              isFailed ? 'bg-gradient-to-r from-red-700 to-red-500'
              : hasWarning ? 'bg-gradient-to-r from-amber-600 to-amber-400'
              : isDone ? 'bg-gradient-to-r from-green-600 to-green-400'
              : 'bg-gradient-to-r from-blue-600 to-blue-400'
            }`}
            style={{ width: `${Math.max(phasePct, 3)}%` }}
          />
          {!isDone && !isFailed && (
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-full animate-pulse"
              style={{ width: `${Math.max(phasePct, 3)}%` }}
            />
          )}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className={`text-[11px] font-medium ${
            isFailed ? 'text-red-400' : hasWarning ? 'text-amber-400' : isDone ? 'text-green-400' : 'text-blue-400'
          }`}>
            {phasePct}%{liveFetched && !isDone && !isFailed ? ` — ${liveFetched} creatives` : ''}
          </span>
          <span className="text-[11px] text-gray-500">
            {isDone ? (hasWarning ? 'Completed with warnings' : 'Completed successfully')
            : isFailed ? (progress.message || 'Scrape failed')
            : eta !== null && eta > 0
              ? `ETA ~${eta >= 60 ? `${Math.ceil(eta / 60)}m` : `${eta}s`}`
              : liveTotal ? `of ${liveTotal}` : ''}
          </span>
        </div>
      </div>

      {/* Live metric counters — show progress data during scrape, final data when done */}
      <div className="px-5 pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-gray-800/40 rounded-lg px-3 py-2.5 border border-gray-700/30">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Fetched</div>
            <div className="text-lg font-bold tabular-nums text-blue-400">
              {liveFetched || (job.creatives_synced || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-3 py-2.5 border border-gray-700/30">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">SpyOwl Total</div>
            <div className="text-lg font-bold tabular-nums text-gray-300">
              {liveTotal || (job.total_api || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-3 py-2.5 border border-gray-700/30">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Synced</div>
            <div className="text-lg font-bold tabular-nums text-green-400">
              {(job.creatives_synced || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-3 py-2.5 border border-gray-700/30">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Brands</div>
            <div className="text-lg font-bold tabular-nums text-amber-400">
              {(job.brands_updated || 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Step log */}
      {progress.steps && progress.steps.length > 0 && (
        <div className="border-t border-gray-800/40 px-5 py-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Activity Log</div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {progress.steps.map((step, i) => (
              <div key={step.id || i} className="flex items-center gap-2.5 text-xs">
                <span className={`shrink-0 w-3 text-center ${
                  step.status === 'done' ? 'text-green-400' :
                  step.status === 'active' ? 'text-blue-400 animate-pulse' :
                  step.status === 'warning' ? 'text-amber-400' :
                  step.status === 'failed' ? 'text-red-400' : 'text-gray-600'
                }`}>
                  {step.status === 'done' ? '✓' : step.status === 'active' ? '●' : step.status === 'warning' ? '!' : step.status === 'failed' ? '✗' : '○'}
                </span>
                <span className="text-gray-600 font-mono w-10 shrink-0 tabular-nums">
                  {formatStepTime(job.started_at, step.ts)}
                </span>
                <span className={
                  step.status === 'active' ? 'text-blue-300' :
                  step.status === 'warning' ? 'text-amber-300' :
                  step.status === 'failed' ? 'text-red-400' : 'text-gray-400'
                }>{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function ScrapeControl({ token, spyowlConnected }) {
  const [history, setHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/scraper/history?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setHistory(await res.json());
    } catch { /* silent */ }
    setLoadingHistory(false);
  }, [token]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Poll for active job updates
  useEffect(() => {
    if (!history?.has_active) return;
    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, [history?.has_active, fetchHistory]);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch('/api/admin/scraper/trigger', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      let data;
      try { data = await res.json(); } catch { data = res.ok ? { success: true, message: 'Scrape initiated' } : { error: `HTTP ${res.status}` }; }
      setTriggerResult(data);
      fetchHistory();
    } catch (e) {
      setTriggerResult({ error: e.message });
    }
    setTriggering(false);
  };

  const handleCancel = async () => {
    if (!confirm('Cancel the active scrape job?')) return;
    setCancelling(true);
    try {
      const res = await fetch('/api/admin/scraper/history', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ job_id: activeJob?.id }),
      });
      const data = await res.json();
      setTriggerResult(data.success ? { success: true, message: 'Scrape cancelled' } : { error: data.error || 'Cancel failed' });
      fetchHistory();
    } catch (e) {
      setTriggerResult({ error: e.message });
    }
    setCancelling(false);
  };

  const activeJob = history?.active_job;
  const hasRuns = history?.runs?.length > 0;

  const statusColors = {
    pending: 'text-yellow-400 bg-yellow-500/10',
    running: 'text-blue-400 bg-blue-500/10',
    completed: 'text-green-400 bg-green-500/10',
    failed: 'text-red-400 bg-red-500/10',
  };

  const statusIcons = {
    pending: '⏳',
    running: '⚡',
    completed: '✓',
    failed: '✗',
  };

  function formatDuration(start, end) {
    if (!start || !end) return '—';
    const sec = Math.round((new Date(end) - new Date(start)) / 1000);
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              Scrape Control
              {activeJob && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full animate-pulse">
                  ⚡ Running
                </span>
              )}
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Trigger on-demand scrapes • Auto-scrape runs daily at midnight UTC</p>
          </div>
          <div className="flex items-center gap-2">
            {hasRuns && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs font-medium text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition"
              >
                {showHistory ? 'Hide' : 'Show'} History
              </button>
            )}
            {activeJob ? (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="text-sm font-semibold px-5 py-2 rounded-lg transition flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30"
              >
                {cancelling ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>\u25a0 Cancel Scrape</>
                )}
              </button>
            ) : (
              <button
                onClick={handleTrigger}
                disabled={triggering || !spyowlConnected}
                className={`text-sm font-semibold px-5 py-2 rounded-lg transition flex items-center gap-2 ${
                  triggering || !spyowlConnected
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30'
                }`}
              >
                {triggering ? (
                  <>
                    <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                    Initiating...
                  </>
                ) : !spyowlConnected ? (
                  <>\ud83d\udd0c SpyOwl Disconnected</>
                ) : (
                  <>\u25b6 Run Scrape Now</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Trigger result feedback */}
        {triggerResult && (
          <div className={`text-sm rounded-lg px-4 py-3 mb-3 ${
            triggerResult.success
              ? 'bg-green-500/10 border border-green-500/20 text-green-300'
              : 'bg-red-500/10 border border-red-500/20 text-red-300'
          }`}>
            {triggerResult.success
              ? `✓ Scrape initiated — ${triggerResult.message}`
              : `✗ ${triggerResult.error}`}
          </div>
        )}

        {/* Active job live status panel */}
        {activeJob && <ActiveJobPanel job={activeJob} avgDuration={history?.summary?.avg_duration_seconds} />}

        {/* Last scrape summary (when no active job) */}
        {!activeJob && hasRuns && !showHistory && (
          <div className="flex items-center gap-4 text-sm">
            {(() => {
              const last = history.runs[0];
              return (
                <>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[last.status]}`}>
                    {statusIcons[last.status]} {last.status}
                  </span>
                  <span className="text-gray-500">
                    {last.started_at ? new Date(last.started_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  {last.status === 'completed' && (
                    <>
                      <span className="text-gray-400">
                        {last.new_brands || 0} new brands • {last.new_creatives || 0} new creatives
                      </span>
                      <span className="text-gray-600">
                        {formatDuration(last.started_at, last.finished_at)}
                      </span>
                    </>
                  )}
                  {last.status === 'failed' && last.error_message && (
                    <span className="text-red-400/70 text-xs truncate max-w-xs">{last.error_message}</span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 capitalize">{last.trigger_type || 'manual'}</span>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Scrape History Table */}
      {showHistory && hasRuns && (
        <div className="border-t border-gray-800/60">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800/60">
                  <th className="text-left px-5 py-2">Status</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Started</th>
                  <th className="text-right px-3 py-2">Duration</th>
                  <th className="text-right px-3 py-2">New Brands</th>
                  <th className="text-right px-3 py-2">New Creatives</th>
                  <th className="text-right px-3 py-2">Total Synced</th>
                  <th className="text-right px-3 py-2">API Calls</th>
                  <th className="text-left px-5 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {history.runs.map((run) => (
                  <tr key={run.id} className="border-b border-gray-800/30 hover:bg-white/[0.02] transition">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[run.status]}`}>
                        {statusIcons[run.status]} {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-gray-400 capitalize">{run.trigger_type || 'manual'}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-400 text-xs">
                      {run.started_at ? new Date(run.started_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="text-right px-3 py-3 text-gray-400 text-xs">
                      {formatDuration(run.started_at, run.finished_at)}
                    </td>
                    <td className="text-right px-3 py-3 text-green-400 font-medium">{run.new_brands || 0}</td>
                    <td className="text-right px-3 py-3 text-blue-400 font-medium">{run.new_creatives || 0}</td>
                    <td className="text-right px-3 py-3 text-gray-400">{run.creatives_synced || 0}</td>
                    <td className="text-right px-3 py-3 text-gray-500">{run.total_api || 0}</td>
                    <td className="px-5 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                      {run.geo_filter || (run.error_message ? <span className="text-red-400/70">{run.error_message}</span> : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.summary && (
            <div className="px-5 py-3 border-t border-gray-800/40 flex items-center gap-6 text-xs text-gray-500">
              <span>Total runs: {history.summary.total_runs}</span>
              <span>Completed: {history.summary.completed}</span>
              <span>Failed: {history.summary.failed}</span>
              {history.summary.avg_duration_seconds > 0 && (
                <span>Avg duration: {formatDuration(0, history.summary.avg_duration_seconds * 1000)}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COUNTRIES TAB COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function CountryRankingCard({ title, sub, items, valueLabel, color = 'blue' }) {
  const barColors = {
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    amber: 'bg-amber-500',
  };
  if (!items || items.length === 0) return null;
  const maxVal = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-5">
      <SectionHeader title={title} sub={sub} />
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.code} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-5 text-right">{i + 1}</span>
            <span className="text-base w-7">{item.flag}</span>
            <span className="text-sm text-white w-28 truncate">{item.name}</span>
            <div className="flex-1 h-5 bg-gray-800/50 rounded overflow-hidden">
              <div
                className={`h-full ${barColors[color]} rounded opacity-70`}
                style={{ width: `${(item.value / maxVal) * 100}%` }}
              />
            </div>
            <span className="text-sm font-bold text-gray-300 w-16 text-right">
              {typeof item.value === 'number' && item.value % 1 !== 0 ? item.value.toFixed(1) : item.value?.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {valueLabel && <div className="text-[10px] text-gray-600 text-right mt-2">{valueLabel}</div>}
    </div>
  );
}

function CountryDetailRow({ country, isExpanded, onToggle }) {
  return (
    <>
      <tr
        className="border-b border-gray-800/30 hover:bg-white/[0.02] transition cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">{country.flag}</span>
            <span className="text-sm text-white font-medium">{country.name}</span>
            <span className="text-[10px] text-gray-600 ml-1">{country.code}</span>
          </div>
        </td>
        <td className="text-right px-3 py-3 text-gray-300 font-bold">{country.total_funnels.toLocaleString()}</td>
        <td className="text-right px-3 py-3">
          <span className={country.active_funnels > 0 ? 'text-green-400' : 'text-gray-600'}>{country.active_funnels}</span>
        </td>
        <td className="text-right px-3 py-3 text-red-400 font-bold">{country.total_velocity}</td>
        <td className="text-right px-3 py-3">
          <span className={`font-bold ${country.avg_scam_score >= 50 ? 'text-red-400' : country.avg_scam_score >= 30 ? 'text-amber-400' : 'text-gray-400'}`}>
            {country.avg_scam_score}
          </span>
        </td>
        <td className="text-right px-3 py-3 text-purple-400">{country.unique_celebrities}</td>
        <td className="text-right px-3 py-3 text-gray-400">{country.total_celeb_mentions.toLocaleString()}</td>
        <td className="text-right px-3 py-3 text-gray-500">{country.campaign_duration_days}d</td>
        <td className="text-right px-4 py-3 text-gray-500 text-xs">
          {country.languages.slice(0, 3).join(', ')}
          {country.languages.length > 3 && ` +${country.languages.length - 3}`}
        </td>
        <td className="px-3 py-3 text-center">
          <span className={`text-gray-500 transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-900/30">
          <td colSpan={10} className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Top Funnels (by velocity)</h4>
                <div className="space-y-1">
                  {country.top_funnels.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-sm py-1">
                      <span className="text-gray-300 truncate mr-3">{f.name}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-red-400 font-bold text-xs">{f.velocity_7d} vel</span>
                        <span className="text-gray-500 text-xs">{f.total_creatives} ads</span>
                        <span className={`text-xs font-bold ${f.scam_score >= 80 ? 'text-red-400' : f.scam_score >= 60 ? 'text-amber-400' : 'text-gray-500'}`}>
                          {f.scam_score}
                        </span>
                      </div>
                    </div>
                  ))}
                  {country.top_funnels.length === 0 && <span className="text-gray-600 text-xs">No funnels</span>}
                </div>
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Campaign Timeline</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">First seen</span>
                    <span className="text-gray-300">{country.earliest_campaign ? new Date(country.earliest_campaign).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Latest activity</span>
                    <span className="text-gray-300">{country.latest_activity ? new Date(country.latest_activity).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Duration</span>
                    <span className="text-gray-300">{country.campaign_duration_days} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Languages</span>
                    <span className="text-gray-300">{country.languages.join(', ') || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CountriesTab({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('total_funnels');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [expandedCode, setExpandedCode] = useState(null);

  const fetchCountries = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/scraper/countries', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchCountries(); }, [fetchCountries]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Loading country intelligence...
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-3">Failed to load country data</p>
        <button onClick={fetchCountries} className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 transition">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const sortableFields = [
    { key: 'total_funnels', label: 'Funnels' },
    { key: 'active_funnels', label: 'Active' },
    { key: 'total_velocity', label: 'Velocity' },
    { key: 'avg_scam_score', label: 'Score' },
    { key: 'unique_celebrities', label: 'Celebs' },
    { key: 'total_celeb_mentions', label: 'Mentions' },
    { key: 'campaign_duration_days', label: 'Duration' },
  ];

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const filtered = (data.countries || [])
    .filter(c => {
      if (!search) return true;
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = a[sortField] || 0;
      const bv = b[sortField] || 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Countries Targeted" value={data.total_countries} color="blue" icon="🌍" />
        <StatCard
          label="Most Targeted"
          value={data.countries[0]?.name || '—'}
          sub={`${data.countries[0]?.total_funnels || 0} funnels`}
          color="red"
        />
        <StatCard
          label="Most Celeb Abuse"
          value={data.rankings.by_celebrities[0]?.name || '—'}
          sub={`${data.rankings.by_celebrities[0]?.value || 0} unique celebs`}
          color="purple"
        />
        <StatCard
          label="Highest Threat"
          value={data.rankings.by_threat[0]?.name || '—'}
          sub={`avg score ${data.rankings.by_threat[0]?.value || 0}`}
          color="amber"
        />
      </div>

      {/* Rankings Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CountryRankingCard
          title="Top by Funnels"
          sub="Most scam funnels targeting this country"
          items={data.countries.slice(0, 10).map(c => ({ code: c.code, name: c.name, flag: c.flag, value: c.total_funnels }))}
          valueLabel="funnels"
          color="blue"
        />
        <CountryRankingCard
          title="Top by Celebrity Abuse"
          sub="Most unique celebrities exploited"
          items={data.rankings.by_celebrities}
          valueLabel="unique celebrities"
          color="purple"
        />
        <CountryRankingCard
          title="Top by Velocity"
          sub="Highest combined ad velocity this week"
          items={data.rankings.by_velocity}
          valueLabel="velocity/week"
          color="red"
        />
      </div>

      {/* Full Country Table */}
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <SectionHeader title="All Countries" sub={`${filtered.length} of ${data.total_countries} countries`} />
          <input
            type="text"
            placeholder="Search country..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 w-48"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800/60">
                <th className="text-left px-4 py-2">Country</th>
                {sortableFields.map(f => (
                  <th
                    key={f.key}
                    className="text-right px-3 py-2 cursor-pointer hover:text-gray-300 transition select-none"
                    onClick={() => handleSort(f.key)}
                  >
                    {f.label}
                    {sortField === f.key && (
                      <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
                    )}
                  </th>
                ))}
                <th className="text-right px-4 py-2">Langs</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <CountryDetailRow
                  key={c.code}
                  country={c}
                  isExpanded={expandedCode === c.code}
                  onToggle={() => setExpandedCode(expandedCode === c.code ? null : c.code)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE WITH TABS
   ═══════════════════════════════════════════════════════════════ */

export default function ScraperPage() {
  const { token } = useAdmin();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

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

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'countries', label: 'Countries' },
  ];

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

      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-900/50 border border-gray-800/60 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition ${
              activeTab === tab.id
                ? 'bg-white/10 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <>
          {/* SpyOwl Connection Status */}
          <SpyOwlBanner spyowl={spyowl} />

          {/* Scrape Control Panel */}
          <ScrapeControl token={token} spyowlConnected={spyowl?.connected} />

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
            <StatCard label="Dead" value={activity.dead} color="gray" />
          </div>

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
        </>
      )}

      {activeTab === 'countries' && (
        <CountriesTab token={token} />
      )}
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
