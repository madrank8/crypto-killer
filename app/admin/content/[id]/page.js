'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useAdmin } from '@/lib/admin-context';

const TipTapEditor = dynamic(() => import('@/components/TipTapEditor'), { ssr: false });

function extractFaqFromSections(rawFaq) {
  return Array.isArray(rawFaq) ? rawFaq : [];
}

function sectionsToHtml(sections = []) {
  return (sections || [])
    .map((s) => `<h2>${s.heading || 'Section'}</h2><p>${(s.body || '').replace(/\n+/g, '<br/>')}</p>`)
    .join('\n');
}

export default function ContentEditorPage({ params }) {
  const { id } = params;
  const { token } = useAdmin();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [content, setContent] = useState(null);
  const [topic, setTopic] = useState(null);

  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [fullArticle, setFullArticle] = useState('');
  const [faq, setFaq] = useState([]);

  const wordCount = useMemo(
    () => String(fullArticle || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length,
    [fullArticle]
  );

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/admin/content/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load content');
        const data = await res.json();
        setContent(data);
        setTopic(data.topic || null);
        setTitle(data.title || '');
        setHeadline(data.headline || '');
        setMetaDescription(data.meta_description || '');
        setFaq(extractFaqFromSections(data.faq));
        setFullArticle(data.full_article || sectionsToHtml(data.sections || []));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, id]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch(`/api/admin/content/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          headline,
          meta_description: metaDescription,
          full_article: fullArticle,
          faq,
          word_count: wordCount,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Save failed');
      }
      setMsg('Saved');
      setTimeout(() => setMsg(''), 1800);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const publishAction = async (action) => {
    setPublishing(true);
    setError('');
    setMsg('');
    try {
      await save();
      const res = await fetch(`/api/admin/content/${id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${action} failed`);

      setContent((prev) => ({ ...prev, status: data.status, published_at: data.published_at }));
      if (data.live_sync?.success) {
        setMsg(`Published and synced to /blog (${data.blog_url})`);
      } else if (action === 'publish') {
        setMsg(`Published, but blog sync failed: ${data.live_sync?.error || 'unknown error'}`);
      } else {
        setMsg('Unpublished');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading content...</div>;
  if (error && !content) return <div className="text-red-400 text-sm">{error}</div>;
  if (!content) return <div className="text-gray-500 text-sm">Content not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/admin/topical-map" className="text-gray-500 hover:text-gray-300">
            ←
          </Link>
          <h1 className="text-lg font-bold text-white">Content Editor</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs ${content.status === 'published' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {content.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || publishing} className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white">
            {saving ? 'Saving...' : msg === 'Saved' ? 'Saved' : 'Save'}
          </button>
          {content.status === 'published' ? (
            <button onClick={() => publishAction('unpublish')} disabled={publishing || saving} className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white">
              {publishing ? 'Working...' : 'Unpublish'}
            </button>
          ) : (
            <button onClick={() => publishAction('publish')} disabled={publishing || saving} className="text-sm px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white">
              {publishing ? 'Publishing...' : 'Publish to /blog'}
            </button>
          )}
        </div>
      </div>

      {(error || msg) && (
        <div className={`text-sm rounded-lg px-3 py-2 ${error ? 'bg-red-900/20 border border-red-600/30 text-red-400' : 'bg-green-900/20 border border-green-600/30 text-green-400'}`}>
          {error || msg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="search-input w-full"
          />
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Headline"
            className="search-input w-full"
          />
          <textarea
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            placeholder="Meta description"
            className="search-input w-full min-h-[68px]"
          />

          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-3">
            <TipTapEditor value={fullArticle} onChange={setFullArticle} />
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-gray-500">Topic Intel</h3>
            <p className="text-sm text-white">{topic?.title || '—'}</p>
            <p className="text-xs text-gray-500">Keyword: {topic?.target_keyword || '—'}</p>
            <p className="text-xs text-gray-500">Volume: {topic?.search_volume ?? '—'}</p>
            <p className="text-xs text-gray-500">KD: {topic?.keyword_difficulty ?? '—'}</p>
            <p className="text-xs text-gray-500">Priority: {topic?.priority_score ?? '—'}</p>
          </div>

          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-gray-500">Quality</h3>
            <p className="text-sm text-white">{wordCount.toLocaleString()} words</p>
            <p className="text-xs text-gray-500">{faq.length} FAQ items</p>
            <p className="text-xs text-gray-500">Slug: {content.slug}</p>
          </div>

          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Internal Links</h3>
            <ul className="space-y-1 text-xs text-gray-400">
              {(content.internal_links || []).slice(0, 8).map((l, i) => (
                <li key={i}>• {l.anchor_text || l.target_topic || 'Link'}</li>
              ))}
              {(!content.internal_links || content.internal_links.length === 0) && <li>No links yet</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

