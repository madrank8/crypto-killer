'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const COLUMNS = [
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

const PRI = { P0: 'text-red-400', P1: 'text-amber-400', P2: 'text-gray-400' };

export default function WorkPlanPage() {
  const { token } = useAdmin();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/work-plan', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Load failed');
      setItems(data.items || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(fingerprint, status) {
    const res = await fetch(`/api/admin/work-plan/${encodeURIComponent(fingerprint)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Update failed');
      return;
    }
    load();
  }

  async function runAdvisor() {
    setError(null);
    const res = await fetch('/api/admin/advisor/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Advisor failed');
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-white">Work Plan</h1>
          <p className="text-xs text-gray-500 mt-1">
            Queue fed by Advisor, chat, and map autodraft. Writer fills drafts only — publish stays manual unless AGENT_AUTOPUBLISH is on.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/chat"
            className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-white/5"
          >
            Open chat
          </Link>
          <button
            type="button"
            onClick={runAdvisor}
            className="text-sm px-3 py-2 rounded-lg bg-red-600/20 text-red-300 border border-red-600/30 hover:bg-red-600/30"
          >
            Run Advisor
          </button>
          <button
            type="button"
            onClick={load}
            className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-white/5"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 border border-red-900/50 bg-red-950/30 rounded-lg px-3 py-2">
          {error}
          {(String(error).includes('relation') || String(error).includes('does not exist')) && (
            <span className="block text-xs text-gray-500 mt-1">
              Apply migrations/024_agent_chat_and_work_plan.sql in Supabase if tables are missing.
            </span>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {COLUMNS.map((col) => {
            const colItems = items.filter((i) => i.status === col.key);
            return (
              <div key={col.key} className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 min-h-[200px]">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  {col.label} ({colItems.length})
                </h2>
                <div className="space-y-2">
                  {colItems.map((item) => (
                    <div
                      key={item.fingerprint}
                      className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-[10px] font-bold ${PRI[item.priority] || 'text-gray-400'}`}>
                          {item.priority}
                        </span>
                        <span className="text-[10px] text-gray-600 truncate">
                          {item.action_type === 'write_content' ? 'write_content · autodraft' : item.action_type}
                        </span>
                      </div>
                      <p className="text-white text-sm mt-1 font-medium leading-snug">{item.title}</p>
                      {item.why && <p className="text-xs text-gray-500 mt-1 line-clamp-3">{item.why}</p>}
                      {item.last_error && (
                        <p className="text-xs text-amber-400 mt-1 line-clamp-2">{item.last_error}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.deep_link && item.deep_link.startsWith('/') && (
                          <Link
                            href={item.deep_link}
                            className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:text-white"
                          >
                            Open
                          </Link>
                        )}
                        {col.key === 'queued' && (
                          <button
                            type="button"
                            onClick={() => patch(item.fingerprint, 'dismissed')}
                            className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-400"
                          >
                            Dismiss
                          </button>
                        )}
                        {col.key === 'blocked' && (
                          <button
                            type="button"
                            onClick={() => patch(item.fingerprint, 'queued')}
                            className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-300"
                          >
                            Re-queue
                          </button>
                        )}
                        {(col.key === 'queued' || col.key === 'running' || col.key === 'blocked') && (
                          <button
                            type="button"
                            onClick={() => patch(item.fingerprint, 'done')}
                            className="text-[10px] px-2 py-1 rounded bg-emerald-900/40 text-emerald-300"
                          >
                            Mark done
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {colItems.length === 0 && (
                    <p className="text-xs text-gray-600 py-4 text-center">Empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
