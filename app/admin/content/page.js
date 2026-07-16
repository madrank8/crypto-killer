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
        active ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`ml-1.5 text-xs ${active ? 'text-gray-300' : 'text-gray-600'}`}>{count}</span>
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

export default function ContentListPage() {
  const { token } = useAdmin();
  const searchParams = useSearchParams();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/admin/content/list', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load content');
        if (!alive) return;
        setItems(Array.isArray(data.content) ? data.content : []);
        setStats(data.stats || null);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [token]);

  const filtered = items.filter((c) => {
    if (statusFilter === 'published' && c.status !== 'published') return false;
    if (statusFilter === 'draft' && c.status === 'published') return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(`${c.title} ${c.slug}`.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Content</h1>
          <p className="text-sm text-gray-500">Blog / investigation articles. Click one to open the editor.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StatusTab label="All" count={stats?.total} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <StatusTab label="Published" count={stats?.published} active={statusFilter === 'published'} onClick={() => setStatusFilter('published')} />
        <StatusTab label="Drafts" count={stats?.drafts} active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or slug…"
          aria-label="Search content"
          className="ml-auto text-sm px-3 py-2 rounded-lg bg-dark-card border border-gray-800 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-gray-500">No content matches.</p>
      )}

      <div className="space-y-1.5">
        {filtered.map((c) => (
          <Link
            key={c.id}
            href={`/admin/content/${c.id}`}
            className="block bg-dark-card border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-white truncate">{c.title}</span>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs ${c.status === 'published' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {c.status}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              <span className="truncate">/{c.slug}</span>
              {c.content_type && <span className="text-gray-600">{c.content_type}</span>}
              <span>{c.word_count > 0 ? `${c.word_count.toLocaleString()} words` : 'Empty'}</span>
              {!c.topic_id && <span className="text-gray-600">unattached</span>}
              <span className="ml-auto text-gray-600">Updated {timeAgo(c.updated_at)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
