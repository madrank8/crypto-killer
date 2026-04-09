'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { GenerateProgressOverlay, useGenerateWithProgress } from '@/components/GenerateProgress';

const TipTapEditor = dynamic(() => import('@/components/TipTapEditor'), {
  ssr: false,
  loading: () => (
    <div className="border border-gray-700 rounded-lg p-8 text-gray-500 text-center bg-dark-bg">
      Loading editor...
    </div>
  ),
});

/* ─── Quality Sidebar ─── */
function QualityCard({ wordCount, redFlagCount, faqCount, status }) {
  const wordColor = wordCount >= 1800 ? 'text-green-400' : wordCount >= 1000 ? 'text-amber-400' : 'text-red-400';
  const flagColor = redFlagCount >= 5 ? 'text-green-400' : 'text-amber-400';
  const faqColor = faqCount >= 5 ? 'text-green-400' : 'text-amber-400';

  const metrics = [
    { label: 'Words', value: wordCount, color: wordColor, target: '1800+' },
    { label: 'Red Flags', value: redFlagCount, color: flagColor, target: '5+' },
    { label: 'FAQs', value: faqCount, color: faqColor, target: '5+' },
  ];

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Quality Score</h3>
      <div className="space-y-2.5">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">{m.label}</span>
            <div className="flex items-center gap-2">
              <span className={`font-bold text-sm ${m.color}`}>{m.value}</span>
              <span className="text-gray-600 text-xs">/ {m.target}</span>
            </div>
          </div>
        ))}
        <div className="pt-2.5 mt-1 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Status</span>
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
              status === 'published' ? 'bg-green-950 text-green-300' : 'bg-amber-950 text-amber-300'
            }`}>
              {status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Brand Intel Card ─── */
function BrandIntelCard({ brand }) {
  if (!brand) return null;

  const stats = [
    { label: 'Scam Score', value: brand.scam_score, suffix: '/100', color: 'text-red-400' },
    { label: 'Creatives', value: brand.total_creatives },
    { label: 'Countries', value: brand.total_geos },
    { label: 'Celebrities', value: brand.total_celebrities },
    { label: 'Velocity', value: brand.velocity_7d, suffix: '/wk' },
  ];

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Brand Intel</h3>
      <div className="space-y-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">{s.label}</span>
            <span className={`font-semibold text-sm ${s.color || 'text-white'}`}>
              {s.value}{s.suffix || ''}
            </span>
          </div>
        ))}
      </div>
      {brand.celebrity_list?.length > 0 && (
        <div className="pt-3 mt-3 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-1">Celebrities used:</p>
          <div className="flex flex-wrap gap-1">
            {brand.celebrity_list.slice(0, 8).map((c, i) => (
              <span key={i} className="text-xs bg-dark-surface px-2 py-0.5 rounded text-gray-400">
                {c}
              </span>
            ))}
            {brand.celebrity_list.length > 8 && (
              <span className="text-xs text-gray-600">+{brand.celebrity_list.length - 8}</span>
            )}
          </div>
        </div>
      )}
      {brand.geo_list?.length > 0 && (
        <div className="pt-3 mt-3 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-1">Target countries:</p>
          <p className="text-xs text-gray-400">
            {brand.geo_list.slice(0, 10).join(', ')}
            {brand.geo_list.length > 10 ? ` +${brand.geo_list.length - 10}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Evidence Images Card ─── */
function EvidenceImagesCard({ images, onRemoveImage, onRegenerate, regenerating }) {
  if (images.length === 0 && !regenerating) {
    return (
      <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Evidence Images</h3>
        </div>
        <p className="text-gray-600 text-xs mb-3">No evidence images in article</p>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="w-full py-2 text-xs font-medium rounded-lg bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 border border-amber-600/20 transition flex items-center justify-center gap-1.5"
        >
          <span>🖼️</span> Fetch Evidence Images
        </button>
      </div>
    );
  }

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Evidence Images <span className="text-gray-600">({images.length})</span>
        </h3>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="text-xs font-medium px-2 py-1 rounded-md bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 border border-amber-600/20 transition"
          title="Re-fetch all evidence images from SpyOwl"
        >
          {regenerating ? (
            <span className="flex items-center gap-1"><span className="animate-spin">⟳</span> Fetching...</span>
          ) : (
            <span className="flex items-center gap-1">🔄 Regenerate</span>
          )}
        </button>
      </div>

      <div className="space-y-2">
        {images.map((img, idx) => (
          <div key={idx} className="relative group rounded-lg overflow-hidden border border-gray-800 bg-dark-surface">
            {/* Remove button */}
            <button
              onClick={() => onRemoveImage(img.url)}
              className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/70 hover:bg-red-600 text-gray-400 hover:text-white flex items-center justify-center text-xs transition opacity-0 group-hover:opacity-100"
              title="Remove this image from article"
            >
              ✕
            </button>
            <img
              src={img.url}
              alt={img.alt || 'Evidence'}
              className="w-full h-20 object-cover"
              loading="lazy"
            />
            {img.caption && (
              <p className="text-[10px] text-gray-500 px-2 py-1 truncate">{img.caption}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Editable Red Flags / FAQs ─── */
function EditableList({ items, onItemChange, onItemRemove, onAddItem, itemType }) {
  const isFlags = itemType === 'flag';

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="bg-dark-surface border border-gray-800 rounded-lg p-3 space-y-2">
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
            className="search-input w-full text-sm py-2"
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
            className="search-input w-full text-sm py-2"
          />
          <button onClick={() => onItemRemove(idx)} className="text-red-400 text-xs hover:text-red-300 transition">
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={onAddItem}
        className="w-full py-2.5 border border-dashed border-gray-700 rounded-lg text-gray-500 hover:text-gray-300 hover:border-gray-600 transition text-sm"
      >
        + Add {isFlags ? 'Red Flag' : 'FAQ'}
      </button>
    </div>
  );
}

/* ─── Source Code Editor ─── */
/* SourceEditor removed — now handled by TipTapEditor's built-in HTML mode */

/* ─── Parse evidence images from full_article HTML ─── */
function parseEvidenceImages(html) {
  if (!html) return [];
  const images = [];
  // Match img tags within the evidence grid (creative-images bucket URLs)
  const imgRegex = /<img\s+src="([^"]*\/creative-images\/[^"]+)"[^>]*alt="([^"]*)"[^>]*\/?>/g;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    // Try to extract caption from nearby <p> tag
    const afterImg = html.substring(match.index, match.index + 500);
    const captionMatch = afterImg.match(/<p[^>]*>([^<]*)<\/p>/);
    images.push({
      url: match[1],
      alt: match[2],
      caption: captionMatch ? captionMatch[1] : '',
    });
  }
  return images;
}

/* ─── Unsplash Hero / Content Images Card ─── */
function UnsplashImagesCard({ review, generating, message, onGenerate }) {
  const hasHero = !!review?.hero_image_url;
  const contentImages = Array.isArray(review?.content_images) ? review.content_images : [];

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Unsplash Images
        </h3>
      </div>

      {/* Hero preview */}
      {hasHero ? (
        <div className="mb-3 rounded-lg overflow-hidden border border-gray-800">
          <img
            src={review.hero_image_url}
            alt={review.hero_image_alt || 'Hero'}
            className="w-full h-28 object-cover"
          />
          <div className="px-2 py-1 bg-dark-surface flex items-center justify-between">
            <span className="text-[10px] text-green-400 font-medium">Hero ✓</span>
            {review.hero_image_credit && (
              <span className="text-[10px] text-gray-600 truncate ml-2">{review.hero_image_credit}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-dashed border-gray-700 bg-dark-surface p-3 text-center">
          <span className="text-gray-600 text-xs">No hero image</span>
        </div>
      )}

      {/* Content images preview */}
      {contentImages.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {contentImages.map((img, i) => (
            <div key={i} className="rounded-lg overflow-hidden border border-gray-800">
              <img
                src={img.url}
                alt={img.alt || `Content ${i + 1}`}
                className="w-full h-16 object-cover"
                loading="lazy"
              />
              <div className="px-1.5 py-0.5 bg-dark-surface">
                <span className="text-[10px] text-gray-500">Content {i + 1}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-dashed border-gray-700 bg-dark-surface p-2 text-center">
          <span className="text-gray-600 text-xs">No content images</span>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div className={`mb-3 text-xs px-2 py-1.5 rounded ${
          message.startsWith('✓') ? 'bg-green-950/40 text-green-400' : 'bg-red-950/40 text-red-400'
        }`}>
          {message}
        </div>
      )}

      {/* Generate / Regenerate button */}
      <button
        onClick={onGenerate}
        disabled={generating}
        className="w-full py-2 text-xs font-medium rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-600/20 transition flex items-center justify-center gap-1.5"
      >
        {generating ? (
          <><span className="animate-spin">⟳</span> Generating...</>
        ) : hasHero ? (
          <><span>🔄</span> Regenerate Images</>
        ) : (
          <><span>🖼️</span> Generate Images</>
        )}
      </button>
    </div>
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
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [regeneratingImages, setRegeneratingImages] = useState(false);
  const [imageMsg, setImageMsg] = useState('');
  const [generatingUnsplash, setGeneratingUnsplash] = useState(false);
  const [unsplashMsg, setUnsplashMsg] = useState('');

  // AI Generate with progress tracking
  const gen = useGenerateWithProgress(token);

  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [fullArticle, setFullArticle] = useState('');
  const [redFlags, setRedFlags] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [verdict, setVerdict] = useState('');

  // viewMode now handled inside TipTapEditor (Edit/Preview/HTML toggle)
  const [activeTab, setActiveTab] = useState('article');
  const [editorKey, setEditorKey] = useState(0);

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

  // Parse evidence images from current article
  const evidenceImages = useMemo(() => parseEvidenceImages(fullArticle), [fullArticle]);

  const wordCount = (fullArticle || '')
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter((w) => w).length;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError('');
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

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError('Failed to save. Try again.');
        setTimeout(() => setSaveError(''), 4000);
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveError('Save failed: ' + (err.message || 'network error'));
      setTimeout(() => setSaveError(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishError('');
    setSyncMsg('');
    setPublishing(true);
    try {
      await handleSave();
      const res = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'publish' }),
      });

      if (res.ok) {
        const data = await res.json();
        setReview((r) => ({ ...r, status: 'published' }));
        // Show live sync feedback
        if (data.live_sync?.success) {
          setSyncMsg('✓ Synced to live site');
          setTimeout(() => setSyncMsg(''), 5000);
        } else if (data.live_sync?.error) {
          setSyncMsg(`⚠ Live sync failed: ${data.live_sync.error}`);
        } else if (!data.live_sync) {
          setSyncMsg('⚠ Live sync skipped — REPLIT_SITE_URL not configured');
        }
      } else {
        setPublishError('Error publishing');
      }
    } catch (err) {
      setPublishError('Error publishing');
    } finally {
      setPublishing(false);
    }
  };

  const handleSyncToLive = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const res = await fetch(`/api/admin/reviews/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSyncMsg('✓ Synced to live site');
        setTimeout(() => setSyncMsg(''), 5000);
      } else {
        setSyncMsg(`⚠ Sync failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setSyncMsg(`⚠ Sync failed: ${err.message || 'Network error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleUnpublish = async () => {
    try {
      const res = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'unpublish' }),
      });
      if (res.ok) {
        setReview((r) => ({ ...r, status: 'draft' }));
      } else {
        setPublishError('Failed to unpublish');
        setTimeout(() => setPublishError(''), 4000);
      }
    } catch (err) {
      setPublishError('Unpublish failed: ' + (err.message || 'network error'));
      setTimeout(() => setPublishError(''), 4000);
    }
  };

  const handleAIGenerate = async () => {
    if (!confirm('Generate AI content? This will replace all current content.')) return;
    await gen.generate(review.brand_id);
  };

  // When generation completes, refresh the review data
  const handleGenDone = async () => {
    if (gen.result) {
      try {
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
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error('Error refreshing review:', err);
      }
    }
    gen.reset();
  };

  // ─── Image Management ───
  const handleRegenerateImages = async () => {
    setRegeneratingImages(true);
    setImageMsg('');
    try {
      // Save current article first so the API has the latest version
      await handleSave();

      const res = await fetch(`/api/admin/reviews/${id}/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (data.success) {
        setImageMsg(`${data.images_found} images fetched`);
        // Refresh article from DB
        const refreshRes = await fetch(`/api/admin/reviews/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setFullArticle(refreshData.full_article || '');
          setEditorKey((k) => k + 1);
        }
      } else {
        setImageMsg(data.error || 'Failed to fetch images');
      }
    } catch (err) {
      console.error('Image regeneration error:', err);
      setImageMsg('Error regenerating images');
    } finally {
      setRegeneratingImages(false);
      setTimeout(() => setImageMsg(''), 4000);
    }
  };

  const handleRemoveImage = async (imageUrl) => {
    try {
      const res = await fetch(`/api/admin/reviews/${id}/images`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image_url: imageUrl }),
      });

      const data = await res.json();

      if (data.success) {
        // Refresh article from DB
        const refreshRes = await fetch(`/api/admin/reviews/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setFullArticle(refreshData.full_article || '');
          setEditorKey((k) => k + 1);
        }
      }
    } catch (err) {
      console.error('Image removal error:', err);
    }
  };

  // ─── Unsplash Image Generation ───
  const handleGenerateUnsplashImages = async () => {
    setGeneratingUnsplash(true);
    setUnsplashMsg('');
    try {
      const res = await fetch('/api/admin/images/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ review_id: id, content_count: 2 }),
      });

      const data = await res.json();

      if (data.success) {
        const parts = [];
        if (data.hero) parts.push('Hero image');
        if (data.content_images?.length) parts.push(`${data.content_images.length} content image(s)`);
        setUnsplashMsg(`✓ Generated: ${parts.join(' + ') || 'no images'}`);

        // Refresh review data to pick up new image URLs
        const refreshRes = await fetch(`/api/admin/reviews/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setReview((r) => ({
            ...r,
            hero_image_url: refreshData.hero_image_url,
            hero_image_alt: refreshData.hero_image_alt,
            hero_image_credit: refreshData.hero_image_credit,
            content_images: refreshData.content_images,
          }));
        }
      } else {
        setUnsplashMsg(`✗ ${data.error || 'Failed to generate images'}`);
      }
    } catch (err) {
      console.error('Unsplash image generation error:', err);
      setUnsplashMsg(`✗ Error: ${err.message || 'network error'}`);
    } finally {
      setGeneratingUnsplash(false);
      setTimeout(() => setUnsplashMsg(''), 6000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-2 text-gray-500">
          <span className="animate-spin">⟳</span> Loading review...
        </div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">Review not found</p>
        <Link href="/admin/reviews" className="text-red-400 hover:text-red-300 text-sm">
          ← Back to reviews
        </Link>
      </div>
    );
  }

  const tabs = [
    { key: 'article', label: 'Article' },
    { key: 'redflags', label: `Red Flags (${redFlags.length})` },
    { key: 'faqs', label: `FAQs (${faqs.length})` },
    { key: 'meta', label: 'SEO' },
  ];

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin/reviews" className="text-gray-500 hover:text-gray-300 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-bold text-white truncate">
            {brand?.name || 'Review'}
          </h1>
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${
            review.status === 'published' ? 'bg-green-950 text-green-300' : 'bg-amber-950 text-amber-300'
          }`}>
            {review.status}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* AI Generate */}
          <button
            onClick={handleAIGenerate}
            disabled={gen.isGenerating}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 border border-purple-600/20 transition"
          >
            {gen.isGenerating ? (
              <><span className="animate-spin">⟳</span> Generating...</>
            ) : (
              <><span>✦</span> AI Generate</>
            )}
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-dark-card text-gray-300 hover:text-white border border-gray-800 hover:border-gray-700 transition"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
          </button>

          {/* Publish / Unpublish + View Live + Sync */}
          {review.status === 'published' ? (
            <>
              <a
                href={`https://cryptokiller.org/review/${review.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium px-4 py-2 rounded-lg bg-green-600/10 text-green-400 hover:bg-green-600/20 border border-green-600/20 transition flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                View Live
              </a>
              <button
                onClick={handleSyncToLive}
                disabled={syncing}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-600/20 transition flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? 'Syncing...' : 'Sync to Live'}
              </button>
              <button
                onClick={handleUnpublish}
                className="text-sm font-medium px-4 py-2 rounded-lg text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700 transition"
              >
                Unpublish
              </button>
            </>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition"
            >
              {publishing ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {/* AI Generation Progress Overlay */}
      {gen.isGenerating && (
        <GenerateProgressOverlay
          progress={gen.progress}
          step={gen.step}
          message={gen.message}
          error={gen.error}
          onClose={handleGenDone}
        />
      )}

      {(publishError || saveError) && (
        <div className="py-2 px-3 bg-red-900/20 border border-red-600/30 rounded-lg text-red-400 text-sm">
          {publishError || saveError}
        </div>
      )}

      {syncMsg && (
        <div className={`py-2 px-3 rounded-lg text-sm ${
          syncMsg.startsWith('✓')
            ? 'bg-green-900/20 border border-green-600/30 text-green-400'
            : 'bg-amber-900/20 border border-amber-600/30 text-amber-400'
        }`}>
          {syncMsg}
        </div>
      )}

      {imageMsg && (
        <div className={`py-2 px-3 rounded-lg text-sm ${
          imageMsg.includes('Error') || imageMsg.includes('Failed') || imageMsg.includes('No ')
            ? 'bg-red-900/20 border border-red-600/30 text-red-400'
            : 'bg-green-900/20 border border-green-600/30 text-green-400'
        }`}>
          {imageMsg}
        </div>
      )}

      {/* Layout: Editor + Sidebar */}
      <div className="grid grid-cols-12 gap-5">
        {/* Editor Column */}
        <div className="col-span-8 space-y-3">
          {/* Tab Bar */}
          <div className="flex items-center gap-1 bg-dark-card border border-gray-800 rounded-xl p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                  activeTab === tab.key
                    ? 'bg-white/10 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}

            {/* View toggle now built into TipTapEditor */}
          </div>

          {/* Tab Content */}
          {activeTab === 'article' && (
              <TipTapEditor
                key={editorKey}
                content={fullArticle}
                onChange={setFullArticle}
                placeholder="Start writing your review... Use AI Generate to auto-fill from brand intelligence."
              />
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
            <div className="bg-dark-card border border-gray-800 rounded-xl p-5 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Title <span className="text-gray-600">({title.length}/60)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.substring(0, 60))}
                  placeholder="SEO title"
                  className="search-input w-full text-sm py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Headline</label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Main headline"
                  className="search-input w-full text-sm py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Meta Description <span className="text-gray-600">({metaDescription.length}/155)</span>
                </label>
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value.substring(0, 155))}
                  placeholder="Meta description for search engines"
                  rows="3"
                  className="search-input w-full text-sm py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Verdict</label>
                <textarea
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value)}
                  placeholder="Final verdict paragraph"
                  rows="4"
                  className="search-input w-full text-sm py-2"
                />
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="col-span-4 space-y-4">
          <QualityCard
            wordCount={wordCount}
            redFlagCount={redFlags.length}
            faqCount={faqs.length}
            status={review.status}
          />
          <UnsplashImagesCard
            review={review}
            generating={generatingUnsplash}
            message={unsplashMsg}
            onGenerate={handleGenerateUnsplashImages}
          />
          <EvidenceImagesCard
            images={evidenceImages}
            onRemoveImage={handleRemoveImage}
            onRegenerate={handleRegenerateImages}
            regenerating={regeneratingImages}
          />
          <BrandIntelCard brand={brand} />
        </div>
      </div>
    </div>
  );
}
