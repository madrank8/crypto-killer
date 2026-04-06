'use client';

import { useAdmin } from '@/lib/admin-context';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

const typeColors = {
  pillar_page: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  guide: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  educational: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  comparison: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  recovery_guide: 'bg-green-500/10 text-green-400 border-green-500/20',
  prevention: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  brand_review: 'bg-red-500/10 text-red-400 border-red-500/20',
  listicle: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  glossary: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const statusColors = {
  planned: 'bg-gray-500/10 text-gray-400',
  in_progress: 'bg-blue-500/10 text-blue-400',
  draft: 'bg-amber-500/10 text-amber-400',
  review: 'bg-purple-500/10 text-purple-400',
  published: 'bg-green-500/10 text-green-400',
};

function groupChildrenByParent(topics) {
  const m = new Map();
  for (const t of topics) {
    const key = t.parent_id || 'root';
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(t);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  return m;
}

function TypeBadge({ contentType }) {
  const cls = typeColors[contentType] || typeColors.educational;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {contentType?.replace(/_/g, ' ') || '—'}
    </span>
  );
}

function StatusBadge({ status }) {
  const cls = statusColors[status] || statusColors.planned;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {status?.replace(/_/g, ' ') || '—'}
    </span>
  );
}

function TopicEditor({ topic, token, onCancel, onSaved }) {
  const [title, setTitle] = useState(topic.title || '');
  const [keyword, setKeyword] = useState(topic.target_keyword || '');
  const [priority, setPriority] = useState(String(topic.priority_score ?? 0));
  const [notes, setNotes] = useState(topic.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          target_keyword: keyword || null,
          priority_score: parseInt(priority, 10) || 0,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Save failed');
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-4 rounded-lg border border-gray-800/80 bg-dark-bg/80 space-y-3">
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <input
        className="search-input w-full text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
      />
      <input
        className="search-input w-full text-sm"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="Target keyword"
      />
      <input
        className="search-input w-full text-sm"
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        placeholder="Priority score"
        type="number"
      />
      <textarea
        className="search-input w-full text-sm min-h-[72px]"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
      />
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} className="btn btn-primary text-sm px-3 py-1.5">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

function TopicTree({ topic, byParent, token, onPatch, editingId, setEditingId }) {
  const children = byParent.get(topic.id) || [];
  const isLeaf = children.length === 0;
  const editing = editingId === topic.id;

  const inner = (
    <div className="flex flex-wrap items-start gap-2 py-2 pl-1">
      <div className="flex-1 min-w-[200px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-white text-sm font-medium">{topic.title}</span>
          <TypeBadge contentType={topic.content_type} />
          <StatusBadge status={topic.content_status} />
        </div>
        <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {topic.target_keyword && <span>kw: {topic.target_keyword}</span>}
          {typeof topic.search_volume === 'number' && <span>vol: {topic.search_volume}</span>}
          {typeof topic.keyword_difficulty === 'number' && <span>KD: {topic.keyword_difficulty}</span>}
          <span>pri: {topic.priority_score ?? 0}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-gray-500 hover:text-white p-1"
          title="Edit"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditingId(editing ? null : topic.id);
          }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L7.5 21H3v-4.5L14.732 3.732z" />
          </svg>
        </button>
        {topic.content_type === 'brand_review' ? (
          <Link
            href="/admin/brands"
            className="text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
          >
            Generate review
          </Link>
        ) : (
          <span className="text-xs px-2 py-1 rounded-lg border border-gray-800 text-gray-600 cursor-not-allowed" title="Phase 3">
            Generate content
          </span>
        )}
      </div>
    </div>
  );

  if (isLeaf) {
    return (
      <div className="border-b border-gray-800/40 last:border-0">
        {inner}
        {editing && (
          <TopicEditor
            topic={topic}
            token={token}
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              onPatch();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <details open className="border border-gray-800/60 rounded-xl bg-gray-900/40 mb-2">
      <summary className="cursor-pointer list-none px-3 py-2 rounded-xl hover:bg-white/[0.03]">
        <div className="flex flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span className="text-gray-500 text-xs mr-1">▸</span>
          {inner}
        </div>
      </summary>
      {editing && (
        <div className="px-3 pb-3">
          <TopicEditor
            topic={topic}
            token={token}
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              onPatch();
            }}
          />
        </div>
      )}
      <div className="pl-4 pb-2 space-y-1 border-t border-gray-800/40">
        {children.map((ch) => (
          <TopicTree
            key={ch.id}
            topic={ch}
            byParent={byParent}
            token={token}
            onPatch={onPatch}
            editingId={editingId}
            setEditingId={setEditingId}
          />
        ))}
      </div>
    </details>
  );
}

export default function TopicalMapPage() {
  const { token } = useAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [maps, setMaps] = useState([]);
  const [mapId, setMapId] = useState(searchParams.get('map_id') || '');
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);

  const [genOpen, setGenOpen] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStep, setGenStep] = useState('');
  const [genMessage, setGenMessage] = useState('');
  const [genError, setGenError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const loadMaps = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/admin/topical-map/maps', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setMaps(data.maps || []);
    }
  }, [token]);

  const loadTopicsForMap = useCallback(
    async (id) => {
      if (!token || !id) {
        setTopics([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/topical-map/topics?map_id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTopics(data.topics || []);
        }
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  const loadTopics = useCallback(() => loadTopicsForMap(mapId), [loadTopicsForMap, mapId]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const byParent = useMemo(() => groupChildrenByParent(topics), [topics]);
  const roots = byParent.get('root') || [];

  const statusCounts = useMemo(() => {
    const c = { planned: 0, in_progress: 0, draft: 0, review: 0, published: 0 };
    for (const t of topics) {
      if (c[t.content_status] !== undefined) c[t.content_status] += 1;
    }
    return c;
  }, [topics]);

  const handleMapChange = (id) => {
    setMapId(id);
    setEditingId(null);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('map_id', id);
    else params.delete('map_id');
    router.replace(`/admin/topical-map?${params.toString()}`);
  };

  const runGenerate = async () => {
    if (!token) return;
    setGenerating(true);
    setGenOpen(true);
    setGenError(null);
    setGenProgress(2);
    setGenStep('init');
    setGenMessage('Starting…');

    try {
      const res = await fetch('/api/admin/topical-map/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (typeof data.progress === 'number') setGenProgress(data.progress);
              if (data.step) setGenStep(data.step);
              if (data.message) setGenMessage(data.message);
              if (data.error) {
                setGenError(data.message || 'Error');
              }
              if (data.result?.map_id) {
                const newId = data.result.map_id;
                setMapId(newId);
                const params = new URLSearchParams(searchParams.toString());
                params.set('map_id', newId);
                router.replace(`/admin/topical-map?${params.toString()}`);
                loadMaps();
                loadTopicsForMap(newId);
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      setGenError(e.message);
      setGenStep('error');
    } finally {
      setGenerating(false);
    }
  };

  if (!token) {
    return <div className="text-gray-500 text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Topical Map</h1>
          <p className="text-gray-500 text-sm mt-1">
            Pillars, clusters, and supporting topics for topical authority (Pipeline B).
          </p>
        </div>
        <button
          type="button"
          onClick={runGenerate}
          disabled={generating}
          className="text-sm font-medium px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate map'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
        <label className="text-sm text-gray-400">Map</label>
        <select
          className="search-input text-sm min-w-[220px]"
          value={mapId}
          onChange={(e) => handleMapChange(e.target.value)}
        >
          <option value="">Select a map…</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-600">
          {maps.length} saved map{maps.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Total</p>
          <p className="text-xl font-semibold text-white">{topics.length}</p>
        </div>
        {Object.entries(statusCounts).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">{k.replace(/_/g, ' ')}</p>
            <p className="text-xl font-semibold text-gray-200">{v}</p>
          </div>
        ))}
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading topics…</div>}

      {!loading && mapId && roots.length === 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-6">
          No topics for this map yet. Generate a map to populate the tree.
        </div>
      )}

      {!loading && mapId && roots.length > 0 && (
        <div className="space-y-2">
          {roots.map((r) => (
            <TopicTree
              key={r.id}
              topic={r}
              byParent={byParent}
              token={token}
              onPatch={loadTopics}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          ))}
        </div>
      )}

      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-white font-semibold text-lg">
              {genError ? 'Generation failed' : genStep === 'done' ? 'Map ready' : 'Generating topical map'}
            </h3>
            <p className="text-gray-500 text-sm mt-1">{genMessage}</p>
            <div className="mt-4 h-2 bg-dark-bg rounded-full overflow-hidden border border-gray-800">
              <div
                className={`h-full rounded-full transition-all ${genError ? 'bg-red-500' : 'bg-red-600'}`}
                style={{ width: `${genProgress}%` }}
              />
            </div>
            {(genError || genStep === 'done' || (!generating && genStep === 'error')) && (
              <button
                type="button"
                className="mt-4 w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white"
                onClick={() => {
                  setGenOpen(false);
                  setGenError(null);
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
