'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

function QualityCard({ wordCount, redFlagCount, faqCount, status }) {
  const getWordCountColor = () => {
    if (wordCount >= 1800) return 'text-green-400';
    if (wordCount >= 1000) return 'text-amber-400';
    return 'text-red-400';
  };

  const getRedFlagColor = () => {
    return redFlagCount >= 5 ? 'text-green-400' : 'text-amber-400';
  };

  const getFaqColor = () => {
    return faqCount >= 5 ? 'text-green-400' : 'text-amber-400';
  };

  const getStatusBadge = () => {
    return status === 'published'
      ? 'badge badge-success'
      : 'badge badge-warning';
  };

  return (
    <div className="card border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Quality Indicators</h3>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Word Count</span>
          <span className={`font-semibold ${getWordCountColor()}`}>
            {wordCount}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-400">Red Flags</span>
          <span className={`font-semibold ${getRedFlagColor()}`}>
            {redFlagCount}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-400">FAQs</span>
          <span className={`font-semibold ${getFaqColor()}`}>
            {faqCount}
          </span>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-gray-700">
          <span className="text-gray-400">Status</span>
          <span className={getStatusBadge()}>{status}</span>
        </div>
      </div>
    </div>
  );
}

function PreviewCard({ title, headline, article, redFlagCount, faqCount }) {
  const preview = article.substring(0, 500);

  return (
    <div className="card border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Preview</h3>

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-gray-400 text-xs mb-1">Title</p>
          <p className="text-white font-semibold">{title || '—'}</p>
        </div>

        <div>
          <p className="text-gray-400 text-xs mb-1">Headline</p>
          <p className="text-white">{headline || '—'}</p>
        </div>

        <div>
          <p className="text-gray-400 text-xs mb-1">Article</p>
          <p className="text-gray-300 line-clamp-3">{preview}...</p>
        </div>

        <div className="pt-3 border-t border-gray-700 flex gap-4">
          <div>
            <p className="text-gray-400 text-xs">Red Flags</p>
            <p className="text-white font-semibold">{redFlagCount}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">FAQs</p>
            <p className="text-white font-semibold">{faqCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableList({ items, onItemChange, onItemRemove, onAddItem, itemType }) {
  const isFlags = itemType === 'flag';

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div
          key={idx}
          className="card bg-dark-surface border-gray-700 p-4 space-y-2"
        >
          <input
            type="text"
            value={item.title || item.question || ''}
            onChange={(e) =>
              onItemChange(idx, { ...item, [isFlags ? 'title' : 'question']: e.target.value })
            }
            placeholder={isFlags ? 'Flag title' : 'Question'}
            className="search-input w-full text-sm"
          />
          <textarea
            value={item.description || item.answer || ''}
            onChange={(e) =>
              onItemChange(idx, { ...item, [isFlags ? 'description' : 'answer']: e.target.value })
            }
            placeholder={isFlags ? 'Flag description' : 'Answer'}
            rows="3"
            className="search-input w-full text-sm"
          />
          <button
            onClick={() => onItemRemove(idx)}
            className="btn btn-secondary text-xs"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        onClick={onAddItem}
        className="btn btn-secondary w-full"
      >
        Add {isFlags ? 'Flag' : 'FAQ'}
      </button>
    </div>
  );
}

export default function ReviewEditor({ params }) {
  const { id } = params;
  const { token } = useAdmin();
  const router = useRouter();

  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [article, setArticle] = useState('');
  const [redFlags, setRedFlags] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [verdict, setVerdict] = useState('');

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
          setTitle(data.title || '');
          setHeadline(data.headline || '');
          setMetaDescription(data.meta_description || '');
          setArticle(data.article || '');
          setRedFlags(data.red_flags || []);
          setFaqs(data.faqs || []);
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

  const handleSaveDraft = async () => {
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
          article,
          red_flags: redFlags,
          faqs,
          verdict,
        }),
      });

      if (res.ok) {
        alert('Draft saved');
      } else {
        alert('Error saving draft');
      }
    } catch (err) {
      console.error('Error saving draft:', err);
      alert('Error saving draft');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishError('');
    setPublishing(true);

    try {
      // First save the draft
      const saveRes = await fetch(`/api/admin/reviews/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          headline,
          meta_description: metaDescription,
          article,
          red_flags: redFlags,
          faqs,
          verdict,
        }),
      });

      if (!saveRes.ok) {
        setPublishError('Error saving draft');
        setPublishing(false);
        return;
      }

      // Then publish
      const publishRes = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'publish' }),
      });

      if (publishRes.ok) {
        alert('Review published');
        setReview({ ...review, status: 'published' });
      } else {
        setPublishError('Error publishing review');
      }
    } catch (err) {
      console.error('Error publishing:', err);
      setPublishError('Error publishing review');
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

      if (res.ok) {
        alert('Review unpublished');
        setReview({ ...review, status: 'draft' });
      } else {
        alert('Error unpublishing review');
      }
    } catch (err) {
      console.error('Error unpublishing:', err);
      alert('Error unpublishing review');
    }
  };

  const wordCount = article.split(/\s+/).filter((w) => w).length;

  if (loading) {
    return (
      <div className="py-8">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="py-8">
        <div className="text-gray-400">Review not found</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left Column: Editor */}
      <div className="col-span-7 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Title ({title.length}/60)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.substring(0, 60))}
            placeholder="Article title"
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
            onChange={(e) =>
              setMetaDescription(e.target.value.substring(0, 155))
            }
            placeholder="Meta description for SEO"
            rows="2"
            className="search-input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Full Article ({wordCount} words)
          </label>
          <textarea
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            placeholder="Full article content"
            rows="20"
            className="search-input w-full font-mono text-xs"
          />
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Red Flags</h3>
          <EditableList
            items={redFlags}
            onItemChange={(idx, item) => {
              const updated = [...redFlags];
              updated[idx] = item;
              setRedFlags(updated);
            }}
            onItemRemove={(idx) => {
              setRedFlags(redFlags.filter((_, i) => i !== idx));
            }}
            onAddItem={() => {
              setRedFlags([...redFlags, { title: '', description: '' }]);
            }}
            itemType="flag"
          />
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-4">FAQs</h3>
          <EditableList
            items={faqs}
            onItemChange={(idx, item) => {
              const updated = [...faqs];
              updated[idx] = item;
              setFaqs(updated);
            }}
            onItemRemove={(idx) => {
              setFaqs(faqs.filter((_, i) => i !== idx));
            }}
            onAddItem={() => {
              setFaqs([...faqs, { question: '', answer: '' }]);
            }}
            itemType="faq"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Verdict
          </label>
          <textarea
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
            placeholder="Final verdict"
            rows="4"
            className="search-input w-full"
          />
        </div>
      </div>

      {/* Right Column: Actions & Preview */}
      <div className="col-span-5 space-y-6">
        {/* Action Buttons */}
        <div className="space-y-2">
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="btn btn-secondary w-full"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>

          <button
            onClick={handlePublish}
            disabled={publishing || review.status === 'published'}
            className="btn btn-primary w-full"
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>

          {review.status === 'published' && (
            <button
              onClick={handleUnpublish}
              className="btn btn-secondary w-full"
            >
              Unpublish
            </button>
          )}
        </div>

        {publishError && (
          <div className="p-3 bg-red-900 bg-opacity-20 border border-red-500 rounded text-red-400 text-sm">
            {publishError}
          </div>
        )}

        {/* Quality Indicators */}
        <QualityCard
          wordCount={wordCount}
          redFlagCount={redFlags.length}
          faqCount={faqs.length}
          status={review.status}
        />

        {/* Preview */}
        <PreviewCard
          title={title}
          headline={headline}
          article={article}
          redFlagCount={redFlags.length}
          faqCount={faqs.length}
        />
      </div>
    </div>
  );
}
