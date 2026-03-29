'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with TipTap
const TipTapEditor = dynamic(() => import('@/components/TipTapEditor'), {
  ssr: false,
  loading: () => (
    <div className="border border-gray-700 rounded-lg p-8 text-gray-500 text-center">
      Loading editor...
    </div>
  ),
});

/* ─── Quality Sidebar ─── */
function QualityCard({ wordCount, redFlagCount, faqCount, status }) {
  const getWordCountColor = () => {
    if (wordCount >= 1800) return 'text-green-400';
    if (wordCount >= 1000) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="card border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Quality</h3>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Words</span>
          <span className={`font-semibold ${getWordCountColor()}`}>{wordCount}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Red Flags</span>
          <span className={`font-semibold ${redFlagCount >= 5 ? 'text-green-400' : 'text-amber-400'}`}>{redFlagCount}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">FAQs</span>
          <span className={`font-semibold ${faqCount >= 5 ? 'text-green-400' : 'text-amber-400'}`}>{faqCount}</span>
        </div>
        <div className="flex justify-between items-center pt-3 border-t border-gray-700">
          <span className="text-gray-400">Status</span>
          <span className={status === 'published' ? 'badge badge-success' : 'badge badge-warning'}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Brand Intel Card ─── */
function BrandIntelCard({ brand }) {
  if (!brand) return null;

  return (
    <div className="card border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Brand Intel</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Scam Score</span>
          <span className="text-red-400 font-bold">{brand.scam_score}/100</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Creatives</span>
          <span className="text-white">{brand.total_creatives}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Countries</span>
          <span className="text-white">{brand.total_geos}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Celebrities</span>
          <span className="text-white">{brand.total_celebrities}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">7d Velocity</span>
          <span className="text-white">{brand.velocity_7d}</span>
        </div>
        {brand.celebrity_list?.length > 0 && (
          <div className="pt-2 border-t border-gray-700">
            <span className="text-gray-400 text-xs">Celebrities:</span>
            <p className="text-gray-300 text-xs mt-1">
              {brand.celebrity_list.join(', ')}
            </p>
          </div>
        )}
        {brand.geo_list?.length > 0 && (
          <div className="pt-2 border-t border-gray-700">
            <span className="text-gray-400 text-xs">Countries:</span>
            <p className="text-gray-300 text-xs mt-1">
              {brand.geo_list.slice(0, 10).join(', ')}
              {brand.geo_list.length > 10 ? ` +${brand.geo_list.length - 10} more` : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Editable Red Flags / FAQs ─── */
function EditableList({ items, onItemChange, onItemRemove, onAddItem, itemType }) {
  const isFlags = itemType === 'flag';

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="card bg-dark-surface border-gray-700 p-3 space-y-2">
          <input
            type="text"
            value={isFlags ? (item.flag || item.title || '') : (item.question || '')}
            onChange={(e) =>
              onItemChange(idx, {
                ...item,
                [isFlags ? 'flag' : 'question']: e.target.value,
              })
            }
            placeholder={isFlags ? 'Red flag title' : 'Question'}
            className="search-input w-full text-sm"
          />
          <textarea
            value={isFlags ? (item.detail || item.description || '') : (item.answer || '')}
            onChange={(e) =>
              onItemChange(idx, {
                ...item,
                [isFlags ? 'detail' : 'answer']: e.target.value,
              })
            }
            placeholder={isFlags ? 'Evidence / detail' : 'Answer'}
            rows="2"
            className="search-input w-full text-sm"
          />
          <button onClick={() => onItemRemove(idx)} className="text-red-400 text-xs hover:text-red-300">
            Remove
          </button>
        </div>
      ))}
      <button onClick={onAddItem} className="btn btn-secondary w-full text-sm">
        + Add {isFlags ? 'Red Flag' : 'FAQ'}
      </button>
    </div>
  );
}

/* ─── Source Code Editor ─── */
function SourceEditor({ html, onChange }) {
  return (
    <textarea
      value={html}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-h-[500px] p-4 bg-dark-bg border border-gray-700 rounded-lg font-mono text-sm text-gray-200 focus:outline-none focus:border-brand-green"
      spellCheck={false}
    />
  );
}

/* ═══════════════════════════════════════════
   MAIN EDITOR PAGE
   ═══════════════════════════════════════════ */
export default function ReviewEditor({ params }) {
  const { id } = params;
  const { token } = useAdmin();
  const router = useRouter();

  const [review, setReview] = useState(null);
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishError, setPublishError] = useState('');

  // Editor state
  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [fullArticle, setFullArticle] = useState('');
  const [redFlags, setRedFlags] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [verdict, setVerdict] = useState('');

  // View mode: 'visual' or 'source'
  const [viewMode, setViewMode] = useState('visual');

  // Active tab: 'article', 'redflags', 'faqs', 'meta'
  const [activeTab, setActiveTab] = useState('article');

  // Track external content update for TipTap
  const [editorKey, setEditorKey] = useState(0);

  // Fetch review on mount
  useEffect(() => {
    if (!token) return;

    const fetchReview = async () => {
      try {
        const res = await fetch(`/api/admin/reviews/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          setReview(data);
          setBrand(data.brand || null);
          setTitle(data.title || '');
          setHeadline(data.headline || '');
          setMetaDescription(data.meta_description || '');
          setFullArticle(data.full_article || '');
          setRedFlags(data.red_flags || []);
          setFaqs(data.faq || []);
          setVerdict(data.verdict || '');
        }
      } catch (err) {
        console.error('Error fetching review:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReview();
  }, [token, id]);

  // Word count from HTML (strip tags)
  const wordCount = (fullArticle || '')
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter((w) => w).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, {
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
          red_flags: redFlags,
          faq: faqs,
          verdict,
          word_count: wordCount,
        }),
      });

      if (!res.ok) alert('Error saving');
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishError('');
    setPublishing(true);
    try {
      await handleSave();
      const res = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'publish' }),
      });

      if (res.ok) {
        setReview((r) => ({ ...r, status: 'published' }));
      } else {
        setPublishError('Error publishing');
      }
    } catch (err) {
      setPublishError('Error publishing');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    try {
      const res = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'unpublish' }),
      });

      if (res.ok) setReview((r) => ({ ...r, status: 'draft' }));
    } catch (err) {
      alert('Error unpublishing');
    }
  };

  const handleAIGenerate = async () => {
    if (!confirm('Generate AI content? This will replace current content with AI-generated text based on brand intelligence data.')) return;

    setGenerating(true);
    try {
      const res = await fetch('/api/admin/reviews/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ brand_id: review.brand_id }),
      });

      if (res.ok) {
        // Re-fetch the review to get AI-generated content
        const refreshRes = await fetch(`/api/admin/reviews/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setTitle(data.title || '');
          setHeadline(data.headline || '');
          setMetaDescription(data.meta_description || '');
          setFullArticle(data.full_article || '');
          setRedFlags(data.red_flags || []);
          setFaqs(data.faq || []);
          setVerdict(data.verdict || '');
          // Force TipTap to reinitialize with new content
          setEditorKey((k) => k + 1);
        }
      } else {
        const err = await res.json();
        alert(`AI generation failed: ${err.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('AI generate error:', err);
      alert('AI generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-gray-400">Loading...</div>;
  }

  if (!review) {
    return <div className="py-8 text-gray-400">Review not found</div>;
  }

  const tabs = [
    { key: 'article', label: 'Article' },
    { key: 'redflags', label: `Red Flags (${redFlags.length})` },
    { key: 'faqs', label: `FAQs (${faqs.length})` },
    { key: 'meta', label: 'SEO / Meta' },
  ];

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="text-gray-400 hover:text-white text-sm">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-white truncate max-w-md">
            {brand?.name || 'Review'}
          </h1>
          <span className={review.status === 'published' ? 'badge badge-success' : 'badge badge-warning'}>
            {review.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleAIGenerate}
            disabled={generating}
            className="btn btn-secondary text-sm flex items-center gap-1"
          >
            {generating ? (
              <>
                <span className="animate-spin inline-block">⟳</span> Generating...
              </>
            ) : (
              '✦ AI Generate'
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-secondary text-sm"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          {review.status === 'published' ? (
            <button onClick={handleUnpublish} className="btn btn-secondary text-sm">
              Unpublish
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="btn btn-primary text-sm"
            >
              {publishing ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {publishError && (
        <div className="p-2 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm">
          {publishError}
        </div>
      )}

      {/* Layout: Editor + Sidebar */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Editor */}
        <div className="col-span-8 space-y-4">
          {/* Tab Bar */}
          <div className="flex gap-1 border-b border-gray-700 pb-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm rounded-t transition ${
                  activeTab === tab.key
                    ? 'bg-dark-surface text-white border-b-2 border-brand-green'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}

            {/* Visual / HTML toggle for article tab */}
            {activeTab === 'article' && (
              <div className="ml-auto flex gap-1">
                <button
                  onClick={() => setViewMode('visual')}
                  className={`px-3 py-1 text-xs rounded ${
                    viewMode === 'visual' ? 'bg-brand-green text-black' : 'bg-dark-surface text-gray-400'
                  }`}
                >
                  Visual
                </button>
                <button
                  onClick={() => setViewMode('source')}
                  className={`px-3 py-1 text-xs rounded ${
                    viewMode === 'source' ? 'bg-brand-green text-black' : 'bg-dark-surface text-gray-400'
                  }`}
                >
                  HTML
                </button>
              </div>
            )}
          </div>

          {/* Tab Content */}
          {activeTab === 'article' && (
            <div>
              {viewMode === 'visual' ? (
                <TipTapEditor
                  key={editorKey}
                  content={fullArticle}
                  onChange={setFullArticle}
                  placeholder="Start writing your review article... Use the toolbar to format text, add headings, lists, links, and images."
                />
              ) : (
                <SourceEditor html={fullArticle} onChange={setFullArticle} />
              )}
            </div>
          )}

          {activeTab === 'redflags' && (
            <EditableList
              items={redFlags}
              onItemChange={(idx, item) => {
                const updated = [...redFlags];
                updated[idx] = item;
                setRedFlags(updated);
              }}
              onItemRemove={(idx) => setRedFlags(redFlags.filter((_, i) => i !== idx))}
              onAddItem={() => setRedFlags([...redFlags, { flag: '', detail: '' }])}
              itemType="flag"
            />
          )}

          {activeTab === 'faqs' && (
            <EditableList
              items={faqs}
              onItemChange={(idx, item) => {
                const updated = [...faqs];
                updated[idx] = item;
                setFaqs(updated);
              }}
              onItemRemove={(idx) => setFaqs(faqs.filter((_, i) => i !== idx))}
              onAddItem={() => setFaqs([...faqs, { question: '', answer: '' }])}
              itemType="faq"
            />
          )}

          {activeTab === 'meta' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Title ({title.length}/60)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.substring(0, 60))}
                  placeholder="SEO title"
                  className="search-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Headline
                </label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Main headline"
                  className="search-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Meta Description ({metaDescription.length}/155)
                </label>
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value.substring(0, 155))}
                  placeholder="Meta description for SEO"
                  rows="3"
                  className="search-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Verdict
                </label>
                <textarea
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value)}
                  placeholder="Final verdict paragraph"
                  rows="5"
                  className="search-input w-full"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right: Sidebar */}
        <div className="col-span-4 space-y-4">
          <QualityCard
            wordCount={wordCount}
            redFlagCount={redFlags.length}
            faqCount={faqs.length}
            status={review.status}
          />
          <BrandIntelCard brand={brand} />
        </div>
      </div>
    </div>
  );
}
