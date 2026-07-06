'use client';

import { useAdmin } from '@/lib/admin-context';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Color Systems ───

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

const statusDot = {
  planned: 'bg-gray-500',
  in_progress: 'bg-blue-400',
  draft: 'bg-amber-400',
  review: 'bg-purple-400',
  published: 'bg-green-400',
};

const statusColors = {
  planned: 'bg-gray-500/10 text-gray-400',
  in_progress: 'bg-blue-500/10 text-blue-400',
  draft: 'bg-amber-500/10 text-amber-400',
  review: 'bg-purple-500/10 text-purple-400',
  published: 'bg-green-500/10 text-green-400',
};

// ─── Data Helpers ───

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

function buildDescendantCountMap(byParent) {
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const children = byParent.get(id) || [];
    let total = children.length;
    for (const child of children) {
      total += visit(child.id);
    }
    memo.set(id, total);
    return total;
  };
  return { count: visit };
}

function collectDescendants(topicId, byParent) {
  const result = [];
  const visit = (id) => {
    const children = byParent.get(id) || [];
    for (const ch of children) {
      result.push(ch);
      visit(ch.id);
    }
  };
  visit(topicId);
  return result;
}

// ─── Micro Components ───

function TypeBadge({ contentType }) {
  const cls = typeColors[contentType] || typeColors.educational;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {contentType?.replace(/_/g, ' ') || '\u2014'}
    </span>
  );
}

function StatusBadge({ status }) {
  const cls = statusColors[status] || statusColors.planned;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {status?.replace(/_/g, ' ') || '\u2014'}
    </span>
  );
}

function ProgressRing({ percent, size = 48, stroke = 4, color = '#ef4444' }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

// ─── Topic Editor (inline) ───

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    <div className="mt-2 p-4 rounded-lg border border-gray-700/60 bg-gray-900/80 space-y-3">
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input className="search-input w-full text-sm col-span-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <input className="search-input w-full text-sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Target keyword" />
        <input className="search-input w-full text-sm" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Priority" type="number" />
      </div>
      <textarea className="search-input w-full text-sm min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} className="btn btn-primary text-sm px-3 py-1.5">
          {saving ? 'Saving\u2026' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-300">Cancel</button>
      </div>
    </div>
  );
}

// ─── Topic Row (leaf or nested) ───

function TopicRow({ topic, depth, byParent, token, onPatch, onDelete, onWriteArticle, writingId, editingId, setEditingId, descendantCountById, statusFilter }) {
  const children = byParent.get(topic.id) || [];
  const isLeaf = children.length === 0;
  const editing = editingId === topic.id;
  const descendants = descendantCountById.get(topic.id) || 0;
  const [expanded, setExpanded] = useState(depth < 1); // only auto-expand first level

  // Filter children if status filter is active
  const filteredChildren = useMemo(() => {
    if (!statusFilter) return children;
    return children.filter(ch => {
      if (ch.content_status === statusFilter) return true;
      // Keep parent if any descendant matches
      const desc = collectDescendants(ch.id, byParent);
      return desc.some(d => d.content_status === statusFilter);
    });
  }, [children, statusFilter, byParent]);

  // Status filter: hide this topic if it doesn't match and has no matching descendants
  // (only applied at depth > 0, roots are always shown if they have matching descendants)

  const isPillar = topic.content_type === 'pillar_page';
  const isCluster = !isPillar && !isLeaf;

  // Pillar-level rendering: prominent card
  if (isPillar && depth === 0) {
    const childStatuses = collectDescendants(topic.id, byParent);
    const pubCount = childStatuses.filter(d => d.content_status === 'published').length + (topic.content_status === 'published' ? 1 : 0);
    const totalCount = childStatuses.length + 1;
    const pubPercent = totalCount > 0 ? Math.round((pubCount / totalCount) * 100) : 0;

    return (
      <div className="rounded-2xl border border-gray-700/50 bg-gradient-to-b from-gray-900/80 to-gray-900/40 overflow-hidden">
        {/* Pillar header */}
        <div
          className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="relative flex-shrink-0">
            <ProgressRing percent={pubPercent} size={44} stroke={3.5} color="#a855f7" />
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-purple-300">
              {pubPercent}%
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-white font-semibold text-base truncate">{topic.title}</span>
              <TypeBadge contentType={topic.content_type} />
              <StatusBadge status={topic.content_status} />
            </div>
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
              {topic.target_keyword && <span className="text-gray-400">{topic.target_keyword}</span>}
              <span>{totalCount} topics</span>
              <span className="text-green-400/70">{pubCount} published</span>
              {typeof topic.search_volume === 'number' && <span>vol: {topic.search_volume.toLocaleString()}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <TopicActions
              topic={topic}
              descendants={descendants}
              editingId={editingId}
              setEditingId={setEditingId}
              onDelete={onDelete}
              onWriteArticle={onWriteArticle}
              writingId={writingId}
            />
            <ChevronToggle expanded={expanded} />
          </div>
        </div>

        {editing && (
          <div className="px-5 pb-4">
            <TopicEditor topic={topic} token={token} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onPatch(); }} />
          </div>
        )}

        {/* Children */}
        {expanded && filteredChildren.length > 0 && (
          <div className="border-t border-gray-800/40">
            {filteredChildren.map(ch => (
              <TopicRow
                key={ch.id} topic={ch} depth={depth + 1}
                byParent={byParent} token={token} onPatch={onPatch} onDelete={onDelete}
                onWriteArticle={onWriteArticle} writingId={writingId} editingId={editingId}
                setEditingId={setEditingId} descendantCountById={descendantCountById}
                statusFilter={statusFilter}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Cluster-level rendering: collapsible group with count badge
  if (isCluster) {
    return (
      <div className={`${depth > 1 ? 'ml-4' : ''}`}>
        <div
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02] transition border-b border-gray-800/30"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronToggle expanded={expanded} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-medium truncate">{topic.title}</span>
              <TypeBadge contentType={topic.content_type} />
              <StatusBadge status={topic.content_status} />
              <span className="text-[10px] text-gray-600 tabular-nums">{children.length} sub</span>
            </div>
            {topic.target_keyword && (
              <p className="text-[11px] text-gray-500 mt-0.5 truncate">{topic.target_keyword}</p>
            )}
          </div>
          <TopicActions
            topic={topic}
            descendants={descendants}
            editingId={editingId}
            setEditingId={setEditingId}
            onDelete={onDelete}
            onWriteArticle={onWriteArticle}
            writingId={writingId}
          />
        </div>

        {editing && (
          <div className="px-4 pb-3">
            <TopicEditor topic={topic} token={token} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onPatch(); }} />
          </div>
        )}

        {expanded && (
          <div className="ml-3 border-l border-gray-800/40">
            {filteredChildren.map(ch => (
              <TopicRow
                key={ch.id} topic={ch} depth={depth + 1}
                byParent={byParent} token={token} onPatch={onPatch} onDelete={onDelete}
                onWriteArticle={onWriteArticle} writingId={writingId} editingId={editingId}
                setEditingId={setEditingId} descendantCountById={descendantCountById}
                statusFilter={statusFilter}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Leaf-level rendering: compact single row
  return (
    <div className={`${depth > 1 ? 'ml-4' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition border-b border-gray-800/20">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[topic.content_status] || statusDot.planned}`} title={topic.content_status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-200 text-sm truncate">{topic.title}</span>
            <TypeBadge contentType={topic.content_type} />
          </div>
          {topic.target_keyword && topic.target_keyword !== topic.title && (
            <p className="text-[11px] text-gray-600 mt-0.5 truncate">{topic.target_keyword}</p>
          )}
        </div>
        <TopicActions
          topic={topic}
          descendants={0}
          editingId={editingId}
          setEditingId={setEditingId}
          onDelete={onDelete}
          onWriteArticle={onWriteArticle}
          writingId={writingId}
          compact
        />
      </div>

      {editing && (
        <div className="px-4 pb-3">
          <TopicEditor topic={topic} token={token} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onPatch(); }} />
        </div>
      )}
    </div>
  );
}

// ─── Action Buttons ───

function TopicActions({ topic, descendants, editingId, setEditingId, onDelete, onWriteArticle, writingId, compact }) {
  const editing = editingId === topic.id;
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
      <button
        type="button" title="Edit"
        className="text-gray-600 hover:text-white p-1 transition"
        onClick={() => setEditingId(editing ? null : topic.id)}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L7.5 21H3v-4.5L14.732 3.732z" />
        </svg>
      </button>
      {!compact && (
        <button
          type="button" title={descendants > 0 ? `Delete (${descendants} subtopics)` : 'Delete'}
          className="text-gray-600 hover:text-red-400 p-1 transition"
          onClick={() => onDelete(topic, descendants)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8" />
          </svg>
        </button>
      )}
      {topic.content_type === 'brand_review' ? (
        <Link
          href="/admin/brands"
          className="text-[11px] px-2 py-1 rounded-md border border-gray-700/60 text-gray-400 hover:text-white hover:border-gray-500 transition"
        >
          Review
        </Link>
      ) : topic.content_id ? (
        <Link
          href={`/admin/content/${topic.content_id}`}
          className="text-[11px] px-2 py-1 rounded-md border border-blue-500/30 text-blue-300 hover:text-white hover:border-blue-400/50 transition"
        >
          Edit
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onWriteArticle(topic)}
          disabled={writingId === topic.id}
          className="text-[11px] px-2 py-1 rounded-md border border-green-500/30 text-green-300 hover:text-white hover:border-green-400/50 transition disabled:opacity-50"
        >
          {writingId === topic.id ? '\u2026' : 'Write'}
        </button>
      )}
    </div>
  );
}

// ─── Checkpoint A: editable keyword pool review ───

const aioColor = (risk) =>
  risk === 'critical' ? 'text-red-400' : risk === 'high' ? 'text-orange-400' : risk === 'medium' ? 'text-amber-400' : 'text-green-400';

function PoolReviewCard({ checkpoint, onApprove, onCancel }) {
  const [removedClusters, setRemovedClusters] = useState(() => new Set());
  const [removedKeywords, setRemovedKeywords] = useState(() => new Set());
  const [promoted, setPromoted] = useState(() => new Set());
  const [expandedKey, setExpandedKey] = useState(null);
  const [addText, setAddText] = useState('');
  const [showUnclustered, setShowUnclustered] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleSet = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  const toggleCluster = toggleSet(setRemovedClusters);
  const toggleKeyword = toggleSet(setRemovedKeywords);
  const togglePromoted = toggleSet(setPromoted);

  const addedList = addText
    .split('\n')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const editCount = removedClusters.size + removedKeywords.size + promoted.size + addedList.length;

  const submit = async () => {
    setSubmitting(true);
    try {
      await onApprove({
        removed_cluster_keys: [...removedClusters],
        removed_keywords: [...removedKeywords],
        promoted_keywords: [...promoted],
        added_keywords: addedList,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10">
      <p className="text-amber-300 text-sm font-medium">Keyword pool review</p>
      <p className="text-xs text-gray-400 mt-1">
        {checkpoint.pool_size} keywords → {checkpoint.clusters?.length || 0} SERP clusters
        ({checkpoint.unclustered_count} unclustered). Click a cluster to expand its keywords;
        remove what you don't want, add what's missing.
      </p>

      {/* Clusters */}
      <div className="mt-2 max-h-64 overflow-y-auto space-y-0.5 pr-1">
        {(checkpoint.clusters || []).map((c) => {
          const clusterRemoved = removedClusters.has(c.cluster_key);
          const isExpanded = expandedKey === c.cluster_key;
          return (
            <div key={c.cluster_key} className={`rounded-md ${clusterRemoved ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2 text-[11px] text-gray-400 py-0.5">
                <button
                  type="button"
                  className="text-gray-500 hover:text-white flex-shrink-0 w-4"
                  onClick={() => setExpandedKey(isExpanded ? null : c.cluster_key)}
                  title="Show keywords"
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
                <span className={`text-gray-200 truncate flex-1 ${clusterRemoved ? 'line-through' : ''}`}>{c.head_keyword}</span>
                <span className="tabular-nums">{c.keyword_count} kw</span>
                <span className="tabular-nums">vol {c.total_volume?.toLocaleString?.() ?? c.total_volume}</span>
                {c.authority?.dr_min != null && (
                  <span className={c.authority.dr_min < 30 ? 'text-green-400' : c.authority.dr_min < 50 ? 'text-amber-400' : 'text-gray-500'} title="Weakest DR in top 10 — lower is easier to win">
                    DR≥{c.authority.dr_min}
                  </span>
                )}
                <span className={aioColor(c.aio_risk)}>AIO:{c.aio_risk}</span>
                <button
                  type="button"
                  className={`flex-shrink-0 px-1 ${clusterRemoved ? 'text-green-400 hover:text-green-300' : 'text-gray-600 hover:text-red-400'}`}
                  title={clusterRemoved ? 'Restore cluster' : 'Remove cluster'}
                  onClick={() => toggleCluster(c.cluster_key)}
                >
                  {clusterRemoved ? '↺' : '✕'}
                </button>
              </div>
              {isExpanded && !clusterRemoved && (
                <div className="ml-6 mb-1 flex flex-wrap gap-1">
                  {(c.keywords || []).map((k) => {
                    const kwRemoved = removedKeywords.has(k.keyword);
                    return (
                      <button
                        key={k.keyword}
                        type="button"
                        onClick={() => toggleKeyword(k.keyword)}
                        title={kwRemoved ? 'Restore keyword' : 'Remove keyword'}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                          kwRemoved
                            ? 'border-red-500/40 text-red-400 line-through'
                            : 'border-gray-700/60 text-gray-300 hover:border-red-400/50 hover:text-red-300'
                        }`}
                      >
                        {k.keyword}
                        {k.search_volume != null && <span className="text-gray-500"> {k.search_volume}</span>}
                        <span className="ml-1">{kwRemoved ? '↺' : '✕'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unclustered */}
      {(checkpoint.unclustered || []).length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="text-[11px] text-gray-400 hover:text-white"
            onClick={() => setShowUnclustered(!showUnclustered)}
          >
            {showUnclustered ? '▾' : '▸'} Unclustered keywords ({checkpoint.unclustered_count}) — click + to include as standalone topics
          </button>
          {showUnclustered && (
            <div className="mt-1 flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
              {checkpoint.unclustered.map((u) => {
                const isPromoted = promoted.has(u.keyword);
                const isRemoved = removedKeywords.has(u.keyword);
                if (isRemoved) return null;
                return (
                  <button
                    key={u.keyword}
                    type="button"
                    onClick={() => togglePromoted(u.keyword)}
                    title={isPromoted ? 'Undo include' : 'Include as its own topic'}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                      isPromoted
                        ? 'border-green-500/50 text-green-300 bg-green-900/20'
                        : 'border-gray-700/60 text-gray-400 hover:border-green-400/50 hover:text-green-300'
                    }`}
                  >
                    {isPromoted ? '✓ ' : '+ '}{u.keyword}
                    {u.search_volume != null && <span className="text-gray-500"> {u.search_volume}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add keywords */}
      <label className="block text-[11px] text-gray-400 mt-3 mb-1">
        Add keywords (one per line, max 50) — grounded with real DataForSEO/Ahrefs metrics on approve
      </label>
      <textarea
        className="search-input w-full text-xs min-h-[52px]"
        value={addText}
        onChange={(e) => setAddText(e.target.value)}
        placeholder={'crypto scam recovery uk\nhow to report a crypto scammer'}
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={submitting}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm text-white disabled:opacity-50"
          onClick={submit}
        >
          {submitting ? 'Applying…' : editCount > 0 ? `Approve with ${editCount} edit${editCount === 1 ? '' : 's'} & continue` : 'Approve pool & continue'}
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-400"
          onClick={onCancel}
          title="Cancel this run"
        >
          Cancel run
        </button>
      </div>
    </div>
  );
}

function ChevronToggle({ expanded, size = 'md' }) {
  const cls = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <svg
      className={`${cls} text-gray-500 transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ─── Main Page ───

export default function TopicalMapPage() {
  const { token } = useAdmin();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [maps, setMaps] = useState([]);
  const [mapId, setMapId] = useState(searchParams.get('map_id') || '');
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  // v2 staged-pipeline run state
  const [runOpen, setRunOpen] = useState(false);
  const [run, setRun] = useState(null); // { id, status, current_stage, map_id }
  const [stages, setStages] = useState([]);
  const [stageResults, setStageResults] = useState({}); // stageKey → { summary, ms }
  const [checkpoint, setCheckpoint] = useState(null); // checkpoint_data from GET run
  const [runError, setRunError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [writingId, setWritingId] = useState(null);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedKeyword, setSeedKeyword] = useState('');
  const [seedError, setSeedError] = useState('');

  // Phase 4 — free-form topic / content creation modal state
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContentType, setNewContentType] = useState('blog_post');
  const [newTopicType, setNewTopicType] = useState('supporting');
  const [newKeyword, setNewKeyword] = useState('');
  const [newAttachToMap, setNewAttachToMap] = useState(false);
  const [newError, setNewError] = useState('');
  const [newCreating, setNewCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const loadMaps = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/admin/topical-map/maps', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { const data = await res.json(); setMaps(data.maps || []); }
  }, [token]);

  const loadTopicsForMap = useCallback(async (id) => {
    if (!token || !id) { setTopics([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/topical-map/topics?map_id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); setTopics(data.topics || []); }
    } finally { setLoading(false); }
  }, [token]);

  const loadTopics = useCallback(() => loadTopicsForMap(mapId), [loadTopicsForMap, mapId]);

  useEffect(() => { loadMaps(); }, [loadMaps]);
  useEffect(() => { loadTopics(); }, [loadTopics]);

  const byParent = useMemo(() => groupChildrenByParent(topics), [topics]);
  const roots = byParent.get('root') || [];
  const descendantCountById = useMemo(() => {
    const helper = buildDescendantCountMap(byParent);
    const m = new Map();
    for (const t of topics) m.set(t.id, helper.count(t.id));
    return m;
  }, [byParent, topics]);

  // Search + status filter
  const filteredRoots = useMemo(() => {
    let result = roots;

    // Text search — keep root if it or any descendant matches
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchesTopic = (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.target_keyword?.toLowerCase().includes(q) ||
        t.content_type?.toLowerCase().includes(q);
      const matchesTree = (id) => {
        const children = byParent.get(id) || [];
        for (const ch of children) {
          if (matchesTopic(ch) || matchesTree(ch.id)) return true;
        }
        return false;
      };
      result = result.filter((r) => matchesTopic(r) || matchesTree(r.id));
    }

    // Status filter — keep root if it or any descendant has that status
    if (statusFilter) {
      result = result.filter(r => {
        if (r.content_status === statusFilter) return true;
        const desc = collectDescendants(r.id, byParent);
        return desc.some(d => d.content_status === statusFilter);
      });
    }

    return result;
  }, [roots, byParent, search, statusFilter]);

  // Stats
  const statusCounts = useMemo(() => {
    const c = { planned: 0, in_progress: 0, draft: 0, review: 0, published: 0 };
    for (const t of topics) { if (c[t.content_status] !== undefined) c[t.content_status] += 1; }
    return c;
  }, [topics]);

  const contentTypeCounts = useMemo(() => {
    const c = {};
    for (const t of topics) {
      const ct = t.content_type || 'unknown';
      c[ct] = (c[ct] || 0) + 1;
    }
    return c;
  }, [topics]);

  const publishedPercent = topics.length > 0 ? Math.round((statusCounts.published / topics.length) * 100) : 0;
  const withContent = topics.filter(t => t.content_id).length;

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    if (type !== 'error') setTimeout(() => setToast(null), 3000);
  };

  const handleMapChange = (id) => {
    setMapId(id);
    setEditingId(null);
    setStatusFilter('');
    setSearch('');
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('map_id', id); else params.delete('map_id');
    router.replace(`/admin/topical-map?${params.toString()}`);
  };

  // \u2500\u2500 v2 staged-pipeline run driver \u2500\u2500
  // create run \u2192 loop /advance \u2192 pause at checkpoints \u2192 /approve \u2192 continue.
  // Failed stages are resumable (advance retries the current stage).

  const selectGeneratedMap = useCallback((newId) => {
    setMapId(newId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('map_id', newId);
    router.replace(`/admin/topical-map?${params.toString()}`);
    loadMaps();
    loadTopicsForMap(newId);
  }, [searchParams, router, loadMaps, loadTopicsForMap]);

  const fetchCheckpoint = async (runId) => {
    const res = await fetch(`/api/admin/topical-map/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    setCheckpoint(data.run?.checkpoint_data || null);
  };

  const driveRun = async (runId) => {
    setGenerating(true);
    setRunError(null);
    try {
      // Hard bound: more iterations than stages can ever need.
      for (let i = 0; i < 15; i++) {
        const res = await fetch(`/api/admin/topical-map/runs/${runId}/advance`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (Array.isArray(data.stages) && data.stages.length) setStages(data.stages);
        setStageResults((prev) => ({
          ...prev,
          [data.executed_stage]: { summary: data.summary, ms: data.ms, ok: true },
        }));
        setRun((prev) => ({
          ...(prev || {}),
          id: runId,
          status: data.status,
          current_stage: data.current_stage,
          map_id: data.map_id || prev?.map_id || null,
        }));
        if (data.status === 'awaiting_approval') {
          await fetchCheckpoint(runId);
          return;
        }
        if (data.done) {
          if (data.map_id) selectGeneratedMap(data.map_id);
          return;
        }
      }
      throw new Error('Run did not complete within the expected number of stages');
    } catch (e) {
      setRunError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const startRun = async (topicKeyword) => {
    if (!token) return;
    const keyword = String(topicKeyword || '').trim();
    if (!keyword) { setSeedError('Topic / keyword is required'); return; }

    setSeedOpen(false);
    setSeedError('');
    setRunOpen(true);
    setRun(null);
    setStageResults({});
    setCheckpoint(null);
    setRunError(null);
    setGenerating(true);

    try {
      const res = await fetch('/api/admin/topical-map/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ seed_keyword: keyword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStages(data.stages || []);
      setRun(data.run);
      await driveRun(data.run.id);
    } catch (e) {
      setRunError(e.message);
      setGenerating(false);
    }
  };

  const approveCheckpoint = async (edits = {}) => {
    if (!run?.id) return;
    setCheckpoint(null);
    try {
      const res = await fetch(`/api/admin/topical-map/runs/${run.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(edits),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Approve failed');
      }
      await driveRun(run.id);
    } catch (e) {
      setRunError(e.message);
    }
  };

  const resumeRun = async () => {
    if (run?.id) {
      setRunError(null);
      await driveRun(run.id);
    }
  };

  const cancelRun = async () => {
    if (!run?.id) return;
    if (!window.confirm('Cancel this run? It will stop here and cannot be resumed.')) return;
    try {
      await fetch(`/api/admin/topical-map/runs/${run.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
    setCheckpoint(null);
    setRunOpen(false);
    setRun(null);
    setRunError(null);
  };

  // Phase 4 — create a free-form topic + draft content via the dual-mode
  // /api/admin/content/create endpoint, then navigate to the editor.
  const createFreeForm = async () => {
    if (!token) return;
    const title = newTitle.trim();
    if (!title) { setNewError('Title is required'); return; }
    if (!newContentType) { setNewError('Content type is required'); return; }
    setNewCreating(true);
    setNewError('');
    try {
      const payload = {
        title,
        content_type: newContentType,
        topic_type: newTopicType,
        target_keyword: newKeyword.trim() || title,
      };
      // Optional: attach to currently selected map. Default off — user
      // chose "free-form, default to standalone" in scoping.
      if (newAttachToMap && mapId) payload.map_id = mapId;

      const res = await fetch('/api/admin/content/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to create content');
      }
      const data = await res.json();
      // Reset modal + navigate
      setNewOpen(false);
      setNewTitle('');
      setNewKeyword('');
      setNewContentType('blog_post');
      setNewTopicType('supporting');
      setNewAttachToMap(false);
      router.push(`/admin/content/${data.id}`);
    } catch (e) {
      setNewError(e.message);
    } finally {
      setNewCreating(false);
    }
  };

  const writeArticle = async (topic) => {
    if (!token || !topic?.id) return;
    setWritingId(topic.id);
    try {
      const res = await fetch('/api/admin/content/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ topic_id: topic.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to create content');
      }
      const data = await res.json();
      router.push(`/admin/content/${data.id}`);
    } catch (e) { showToast(e.message); } finally { setWritingId(null); }
  };

  const deleteTopic = async (topic, descendants = 0) => {
    if (!token || !topic?.id) return;
    const hasChildren = descendants > 0;
    const shouldDelete = window.confirm(
      hasChildren
        ? `"${topic.title}" has ${descendants} subtopic(s).\n\nOK = delete topic + all subtopics\nCancel = abort`
        : `Delete "${topic.title}"?`
    );
    if (!shouldDelete) return;
    try {
      const res = await fetch(`/api/admin/topical-map/topics/${topic.id}?cascade=${hasChildren ? 'true' : 'false'}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Delete failed');
      }
      if (editingId === topic.id) setEditingId(null);
      await loadTopics();
      await loadMaps();
    } catch (e) { showToast(`Delete failed: ${e.message}`); }
  };

  if (!token) return <div className="text-gray-500 text-sm">Loading\u2026</div>;

  const selectedMap = maps.find(m => m.id === mapId);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Topical Map</h1>
          <p className="text-gray-500 text-sm mt-1">
            Pillars, clusters & supporting topics for topical authority.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setNewError(''); setNewOpen(true); }}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition"
          >
            + New Content
          </button>
          <button
            type="button"
            onClick={() => { setSeedError(''); setSeedOpen(true); }}
            disabled={generating}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition disabled:opacity-50"
          >
            {generating ? 'Generating\u2026' : '+ New Map'}
          </button>
        </div>
      </div>

      {/* ── Map Selector ── */}
      <div className="flex items-center gap-3">
        <select
          className="search-input text-sm min-w-[240px]"
          value={mapId}
          onChange={(e) => handleMapChange(e.target.value)}
        >
          <option value="">Select a map\u2026</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {selectedMap && (
          <span className="text-xs text-gray-600">{topics.length} topics</span>
        )}
      </div>

      {/* ── Stats Dashboard ── */}
      {mapId && topics.length > 0 && (
        <div className="grid grid-cols-12 gap-3">
          {/* Progress ring + key numbers */}
          <div className="col-span-12 sm:col-span-4 lg:col-span-3 rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <ProgressRing percent={publishedPercent} size={64} stroke={5} color="#22c55e" />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-green-300">
                {publishedPercent}%
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Progress</p>
              <p className="text-sm text-gray-300">
                <span className="text-white font-semibold">{statusCounts.published}</span> / {topics.length} published
              </p>
              <p className="text-xs text-gray-500">{withContent} with content</p>
            </div>
          </div>

          {/* Status breakdown */}
          <div className="col-span-12 sm:col-span-8 lg:col-span-5 rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2.5">By Status</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(statusCounts).map(([status, count]) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition border ${
                    statusFilter === status
                      ? 'border-white/20 bg-white/10 text-white'
                      : 'border-gray-800/60 hover:border-gray-600 text-gray-400 hover:text-white'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
                  <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-gray-300 tabular-nums">{count}</span>
                </button>
              ))}
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('')}
                  className="text-[11px] text-gray-500 hover:text-red-400 px-2 py-1.5 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Content type breakdown */}
          <div className="col-span-12 lg:col-span-4 rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2.5">By Type</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(contentTypeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <span key={type} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border ${typeColors[type] || typeColors.educational}`}>
                    {type.replace(/_/g, ' ')}
                    <span className="font-semibold">{count}</span>
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Search ── */}
      {mapId && topics.length > 0 && (
        <div className="relative">
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search topics, keywords, types\u2026"
            className="search-input w-full pl-9 text-sm"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Loading / Empty States ── */}
      {loading && <div className="text-gray-500 text-sm">Loading topics\u2026</div>}

      {!loading && mapId && roots.length === 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-6 text-center">
          <p className="text-lg mb-1">{'\ud83c\udf31'}</p>
          <p className="text-white font-medium mb-1">No topics yet</p>
          <p>Click "+ New Map" above to create a topical map from a seed keyword.</p>
        </div>
      )}

      {!loading && !mapId && maps.length > 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-6 text-center">
          <p className="text-lg mb-1">{'\ud83d\udccd'}</p>
          <p className="text-white font-medium mb-1">Select a map</p>
          <p>Choose an existing map from the dropdown, or generate a new one.</p>
        </div>
      )}

      {!loading && mapId && filteredRoots.length === 0 && roots.length > 0 && (
        <div className="text-gray-500 text-sm rounded-xl border border-gray-800/60 bg-gray-900/30 p-4">
          No topics match your filters.{' '}
          <button type="button" onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-red-400 hover:text-red-300 underline">
            Clear all
          </button>
        </div>
      )}

      {/* ── Topic Tree ── */}
      {!loading && mapId && filteredRoots.length > 0 && (
        <div className="space-y-4">
          {filteredRoots.map(r => (
            <TopicRow
              key={r.id} topic={r} depth={0}
              byParent={byParent} token={token} onPatch={loadTopics} onDelete={deleteTopic}
              onWriteArticle={writeArticle} writingId={writingId} editingId={editingId}
              setEditingId={setEditingId} descendantCountById={descendantCountById}
              statusFilter={statusFilter}
            />
          ))}
        </div>
      )}

      {/* ── Modals ── */}

      {/* v2 staged pipeline run panel */}
      {runOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 className="text-white font-semibold text-lg">
              {runError ? 'Pipeline stage failed' : run?.status === 'completed' ? 'Map ready' : checkpoint ? 'Checkpoint — your review needed' : 'Building topical map (v2 pipeline)'}
            </h3>
            {run?.seed_keyword && <p className="text-gray-500 text-sm mt-0.5">Seed: {run.seed_keyword}</p>}

            {/* Stage timeline */}
            <div className="mt-4 space-y-1.5">
              {stages.map((s) => {
                const result = stageResults[s.key];
                const isCurrent = run?.current_stage === s.key && run?.status !== 'completed';
                const failed = isCurrent && !!runError;
                return (
                  <div key={s.key} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-sm ${
                    failed ? 'border-red-600/40 bg-red-900/20'
                      : result ? 'border-green-700/30 bg-green-900/10'
                      : isCurrent ? 'border-blue-600/40 bg-blue-900/10'
                      : 'border-gray-800/50'
                  }`}>
                    <span className="mt-0.5 flex-shrink-0">
                      {failed ? <span className="text-red-400">✕</span>
                        : result ? <span className="text-green-400">✓</span>
                        : isCurrent && generating ? <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        : <span className="text-gray-600">○</span>}
                    </span>
                    <div className="min-w-0">
                      <p className={result || isCurrent ? 'text-gray-200' : 'text-gray-500'}>{s.label}</p>
                      {result?.summary && <p className="text-[11px] text-gray-500 mt-0.5">{result.summary}{result.ms ? ` · ${(result.ms / 1000).toFixed(1)}s` : ''}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Checkpoint A: editable pool + cluster review */}
            {checkpoint?.checkpoint === 'pool_review' && (
              <PoolReviewCard checkpoint={checkpoint} onApprove={approveCheckpoint} onCancel={cancelRun} />
            )}

            {/* Checkpoint B: QA report review */}
            {checkpoint?.checkpoint === 'qa_review' && (
              <div className="mt-4 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10">
                <p className="text-amber-300 text-sm font-medium">QA report</p>
                <p className="text-xs text-gray-400 mt-1">
                  {checkpoint.qa_report?.clean_nodes}/{checkpoint.qa_report?.total_nodes} nodes clean.
                </p>
                {checkpoint.qa_report?.counts && Object.keys(checkpoint.qa_report.counts).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Object.entries(checkpoint.qa_report.counts).map(([type, count]) => (
                      <span key={type} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        {type.replace(/_/g, ' ')}: {count}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {(checkpoint.qa_report?.flags || []).slice(0, 30).map((f, i) => (
                    <p key={i} className="text-[11px] text-gray-400"><span className="text-gray-200">{f.title}</span> — {f.detail}</p>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Flags are saved onto each topic (qa_flags) — you can resolve them after the map is created.</p>
                <button type="button" className="mt-3 w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm text-white" onClick={() => approveCheckpoint()}>
                  Approve & save map
                </button>
              </div>
            )}

            {runError && (
              <div className="mt-4 p-3 rounded-lg border border-red-600/30 bg-red-900/10">
                <p className="text-red-300 text-sm">{runError}</p>
                {run?.id && (
                  <button type="button" className="mt-2 w-full py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm text-white" onClick={resumeRun}>
                    Resume from failed stage
                  </button>
                )}
              </div>
            )}

            {!generating && !checkpoint && (
              <button type="button" className="mt-4 w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white" onClick={() => { setRunOpen(false); setRunError(null); }}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Seed keyword modal */}
      {/* Phase 4 — free-form Create Content modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <h3 className="text-white font-semibold text-lg">Create new content</h3>
            <p className="text-gray-500 text-sm mt-1">Write a blog post or page on any topic — no topical map required.</p>

            <label className="block text-xs text-gray-400 mt-4 mb-1">Title</label>
            <input
              type="text" autoFocus value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. How to Spot a Crypto Recovery Scam in 2026"
              className="search-input w-full"
            />

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Content type</label>
                <select
                  className="search-input w-full text-sm"
                  value={newContentType}
                  onChange={(e) => setNewContentType(e.target.value)}
                >
                  <optgroup label="Blog">
                    <option value="blog_post">Blog post</option>
                    <option value="listicle">Listicle</option>
                    <option value="comparison">Comparison</option>
                    <option value="guide">Guide</option>
                    <option value="educational">Educational</option>
                    <option value="prevention">Prevention</option>
                    <option value="recovery_guide">Recovery guide</option>
                    <option value="glossary">Glossary</option>
                  </optgroup>
                  <optgroup label="Page">
                    <option value="informational_page">Informational page</option>
                    <option value="landing_page">Landing page</option>
                    <option value="pillar_page">Pillar page</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Topic role</label>
                <select
                  className="search-input w-full text-sm"
                  value={newTopicType}
                  onChange={(e) => setNewTopicType(e.target.value)}
                >
                  <option value="supporting">Supporting</option>
                  <option value="cluster">Cluster</option>
                  <option value="pillar">Pillar</option>
                </select>
              </div>
            </div>

            <label className="block text-xs text-gray-400 mt-3 mb-1">Target keyword (optional, defaults to title)</label>
            <input
              type="text" value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="e.g. crypto recovery scam"
              className="search-input w-full"
            />

            {mapId && (
              <label className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                <input
                  type="checkbox" checked={newAttachToMap}
                  onChange={(e) => setNewAttachToMap(e.target.checked)}
                />
                Attach to currently selected map
              </label>
            )}

            {newError && <p className="text-red-400 text-sm mt-3">{newError}</p>}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={newCreating}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white disabled:opacity-50"
                onClick={createFreeForm}
              >
                {newCreating ? 'Creating\u2026' : 'Create draft'}
              </button>
              <button
                type="button"
                className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white"
                onClick={() => { setNewOpen(false); setNewError(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {seedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-white font-semibold text-lg">Seed Topic</h3>
            <p className="text-gray-500 text-sm mt-1">Enter the topic/keyword to build this topical map around.</p>
            <input
              type="text" autoFocus value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              placeholder="e.g. pig butchering scam"
              className="search-input w-full mt-4"
              onKeyDown={(e) => { if (e.key === 'Enter') startRun(seedKeyword); }}
            />
            {seedError && <p className="text-red-400 text-sm mt-2">{seedError}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm text-white" onClick={() => startRun(seedKeyword)}>Generate</button>
              <button type="button" className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white" onClick={() => { setSeedOpen(false); setSeedError(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-40 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm ${
          toast.type === 'error' ? 'bg-red-900/90 border-red-600/40 text-red-200' : 'bg-green-900/90 border-green-600/40 text-green-200'
        }`}>
          <span>{toast.msg}</span>
          <button type="button" onClick={() => setToast(null)} className="text-current opacity-60 hover:opacity-100">{'\u2715'}</button>
        </div>
      )}
    </div>
  );
}
