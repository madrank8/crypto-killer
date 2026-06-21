'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  GenerateProgressOverlay,
  useGenerateWithProgress,
  usePolishWithProgress,
  PolishProgressBanner,
} from '@/components/GenerateProgress';
import SeoAeoAudit from '@/components/SeoAeoAudit';
import TranslationsCard from '@/components/TranslationsCard';

const TipTapEditor = dynamic(() => import('@/components/TipTapEditor'), {
  ssr: false,
  loading: () => (
    <div className="border border-gray-700 rounded-lg p-8 text-gray-500 text-center bg-dark-bg">
      Loading editor...
    </div>
  ),
});

function formatPublishErrorPayload(payload, fallbackLabel, status) {
  const prefix = status ? `[HTTP ${status}] ` : '';
  if (!payload || typeof payload !== 'object') return `${prefix}${fallbackLabel}`;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const body = payload.errors.join('\n');
    return payload.reason ? `${prefix}${payload.reason}\n\n${body}` : `${prefix}${body}`;
  }
  if (payload.error && payload.reason) return `${prefix}${payload.error}\n${payload.reason}`;
  if (payload.error) return `${prefix}${payload.error}`;
  return `${prefix}${fallbackLabel}`;
}

/**
 * Turn a failed admin API response into a human-readable message + structured issues.
 * Publish returns 422 with { errors[], reason, issues[] } from the integrity gate.
 */
async function parseAdminApiError(res, fallbackLabel) {
  const prefix = res.status ? `[HTTP ${res.status}] ` : '';
  const raw = await res.text();
  if (!raw) return { message: `${prefix}${fallbackLabel}`, issues: [] };
  try {
    const j = JSON.parse(raw);
    return {
      message: formatPublishErrorPayload(j, fallbackLabel, res.status),
      issues: Array.isArray(j.issues) ? j.issues : [],
      payload: j,
    };
  } catch {
    /* not JSON */
  }
  return { message: `${prefix}${raw.trim() || fallbackLabel}`, issues: [] };
}

const VISUAL_PLACEHOLDER_RE =
  /\[\s*(CHART|DIAGRAM|IMAGE|INFOGRAPHIC|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED[^\]]*\]/gi;

function scrubVisualPlaceholders(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(VISUAL_PLACEHOLDER_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function scrubRedFlagsForSave(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    flag: scrubVisualPlaceholders(item?.flag || ''),
    detail: scrubVisualPlaceholders(item?.detail || item?.description || ''),
  }));
}

function scrubFaqsForSave(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    question: scrubVisualPlaceholders(item?.question || ''),
    answer: scrubVisualPlaceholders(item?.answer || ''),
  }));
}

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

function buildDraftSnapshot({
  title,
  headline,
  metaDescription,
  fullArticle,
  redFlags,
  faqs,
  verdict,
}) {
  return JSON.stringify({
    title: title || '',
    headline: headline || '',
    meta_description: metaDescription || '',
    full_article: fullArticle || '',
    red_flags: Array.isArray(redFlags) ? redFlags : [],
    faq: Array.isArray(faqs) ? faqs : [],
    verdict: verdict || '',
  });
}

/* ─── Midjourney / AI Images Card ─── */
function MidjourneyImagesCard({ review, generating, message, progressMsg, onGenerate }) {
  const hasHero = !!review?.hero_image_url;
  const contentImages = Array.isArray(review?.content_images) ? review.content_images : [];
  const heroSource = review?.hero_image_credit?.includes('Midjourney') ? 'midjourney' : 'unsplash';

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          AI Generated Images
        </h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/50 text-purple-400 border border-purple-800/30">
          Midjourney
        </span>
      </div>

      {/* Hero preview */}
      {hasHero ? (
        <div className="mb-3 rounded-lg overflow-hidden border border-gray-800">
          <img
            src={review.hero_image_url}
            alt={review.hero_image_alt || 'Hero'}
            className="w-full h-28 object-cover"
          />
          <div className="px-2 py-1.5 bg-dark-surface space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-green-400 font-medium">Hero ✓</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                heroSource === 'midjourney'
                  ? 'bg-purple-950/50 text-purple-300'
                  : 'bg-blue-950/50 text-blue-300'
              }`}>
                {heroSource === 'midjourney' ? '✦ MJ' : '📷 Unsplash'}
              </span>
            </div>
            {review.hero_image_alt && (
              <p className="text-[9px] text-gray-600 leading-tight line-clamp-2" title={review.hero_image_alt}>
                {review.hero_image_alt}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-dashed border-gray-700 bg-dark-surface p-4 text-center">
          <div className="text-gray-600 text-2xl mb-1">✦</div>
          <span className="text-gray-600 text-xs">No hero image yet</span>
          <p className="text-[10px] text-gray-700 mt-1">Click generate to create a cinematic Midjourney image</p>
        </div>
      )}

      {/* Content images preview */}
      {contentImages.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {contentImages.map((img, i) => {
            const imgSource = img.credit?.includes('Midjourney') ? 'midjourney' : 'unsplash';
            return (
              <div key={i} className="rounded-lg overflow-hidden border border-gray-800">
                <img
                  src={img.url}
                  alt={img.alt || `Content ${i + 1}`}
                  className="w-full h-16 object-cover"
                  loading="lazy"
                />
                <div className="px-1.5 py-0.5 bg-dark-surface flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">Content {i + 1}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded ${
                    imgSource === 'midjourney'
                      ? 'bg-purple-950/50 text-purple-400'
                      : 'bg-blue-950/50 text-blue-400'
                  }`}>
                    {imgSource === 'midjourney' ? 'MJ' : 'US'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-dashed border-gray-700 bg-dark-surface p-2 text-center">
          <span className="text-gray-600 text-xs">No content images</span>
        </div>
      )}

      {/* Progress indicator during generation */}
      {generating && progressMsg && (
        <div className="mb-3 text-xs px-2.5 py-2 rounded bg-purple-950/30 border border-purple-800/20">
          <div className="flex items-center gap-2 text-purple-300">
            <span className="animate-spin text-sm">⟳</span>
            <span>{progressMsg}</span>
          </div>
          <div className="mt-1.5 w-full bg-purple-950/50 rounded-full h-1">
            <div className="bg-purple-500 h-1 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
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
        className="w-full py-2.5 text-xs font-medium rounded-lg bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 border border-purple-600/20 transition flex items-center justify-center gap-1.5"
      >
        {generating ? (
          <><span className="animate-spin">⟳</span> Generating via Midjourney (~60s)...</>
        ) : hasHero ? (
          <><span>✦</span> Regenerate with Midjourney</>
        ) : (
          <><span>✦</span> Generate with Midjourney</>
        )}
      </button>

      {/* Credits info */}
      <p className="text-[10px] text-gray-700 mt-1.5 text-center">
        ~6 credits per image • Images hosted permanently on CDN
      </p>
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
  const searchParams = useSearchParams();
  const polishQueryParam = searchParams.get('polish');

  const [review, setReview] = useState(null);
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishIssues, setPublishIssues] = useState([]);
  const [autoFixing, setAutoFixing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [regeneratingImages, setRegeneratingImages] = useState(false);
  const [imageMsg, setImageMsg] = useState('');
  const [generatingImages, setGeneratingImages] = useState(false);
  const [imageGenMsg, setImageGenMsg] = useState('');
  const [imageProgressMsg, setImageProgressMsg] = useState('');
  const [aeoFixing, setAeoFixing] = useState(false);
  const [aeoFixingId, setAeoFixingId] = useState(null);

  // AI Generate with progress tracking
  const gen = useGenerateWithProgress(token);

  // Phase B polish (visuals + audit + hero images) — SSE-streamed.
  const polishProgress = usePolishWithProgress(token);
  const [polishBannerDismissed, setPolishBannerDismissed] = useState(false);
  const [polishAutoTriggered, setPolishAutoTriggered] = useState(false);

  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [fullArticle, setFullArticle] = useState('');
  const [redFlags, setRedFlags] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [verdict, setVerdict] = useState('');
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState('');

  // viewMode now handled inside TipTapEditor (Edit/Preview/HTML toggle)
  const [activeTab, setActiveTab] = useState('article');
  const [editorKey, setEditorKey] = useState(0);

  const fetchReview = useCallback(async () => {
    if (!token) return null;
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
        setLastSavedSnapshot(buildDraftSnapshot({
          title: data.title,
          headline: data.headline,
          metaDescription: data.meta_description,
          fullArticle: data.full_article,
          redFlags: data.red_flags,
          faqs: data.faq,
          verdict: data.verdict,
        }));
        return data;
      }
    } catch (err) {
      console.error('Error fetching review:', err);
    } finally {
      setLoading(false);
    }
    return null;
  }, [token, id]);

  useEffect(() => {
    fetchReview();
  }, [fetchReview]);

  // Auto-polish is DISABLED (per request): polishing runs ONLY when the user
  // clicks the Polish button — never automatically on load/refresh or after an
  // AI Generate. This keeps the token-spending audit/visuals/evidence pass under
  // explicit control. Flip AUTO_POLISH back to true to restore chain-on-generate.
  useEffect(() => {
    const AUTO_POLISH = false;
    if (!AUTO_POLISH) return;
    if (!review || polishAutoTriggered || polishProgress.isPolishing) return;
    const status = review.generation_status;
    const shouldAutoPolish =
      polishQueryParam === 'auto' ||
      status === 'content_generated' ||
      status === 'polishing'; // orphaned in-flight from a prior attempt
    if (!shouldAutoPolish) return;
    setPolishAutoTriggered(true);
    setPolishBannerDismissed(false);
    polishProgress.polish(id);
  }, [review, polishQueryParam, polishAutoTriggered, polishProgress, id]);

  // After polish, apply the SEO/AEO auto-fixes the sidebar audit recommends, so
  // a Polish run actually improves the page's SEO — not just visuals/evidence.
  // Only the SAFE STRUCTURAL categories are auto-applied (extractive answers,
  // question-shaped headings, BLUF/answer-first opening, formatting). The
  // generative categories (attribution, freshness, surface) are deliberately
  // EXCLUDED — they invent sources/claims/sections and would trip the
  // fabrication/fake-freshness VETOs in the publish gate. Cheap (claude-haiku,
  // targeted HTML patches). Reads from the freshly-fetched review to avoid any
  // stale-state. Non-fatal: polish already succeeded if this no-ops.
  const runSeoAutoFix = useCallback(async (fresh) => {
    const article = fresh?.full_article;
    if (!article || !token) return;
    try {
      const res = await fetch('/api/admin/aeo-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullArticle: article,
          title: fresh.title || '',
          keyword: fresh.brand_name || fresh.brand?.name || '',
          metaDescription: fresh.meta_description || '',
          fixes: ['extractive', 'headings', 'bluf', 'formatting'],
          contentType: 'review',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.fixedArticle && data.fixedArticle !== article) {
        setFullArticle(data.fixedArticle);
        setEditorKey((k) => k + 1);
        setSyncMsg(`SEO/AEO auto-fixes applied (${(data.fixesApplied || []).join(', ')}). Review & Save to publish.`);
        setTimeout(() => setSyncMsg(''), 9000);
      }
    } catch {
      /* non-fatal — polish already succeeded */
    }
  }, [token]);

  // When the polish stream ends successfully, reload the review (so the editor
  // shows rendered visuals, audit score, hero image, and embedded evidence),
  // then run the SEO/AEO auto-fix on the fresh content.
  useEffect(() => {
    if (polishProgress.step === 'done' && !polishProgress.error) {
      fetchReview().then((fresh) => { if (fresh) runSeoAutoFix(fresh); });
    }
  }, [polishProgress.step, polishProgress.error, fetchReview, runSeoAutoFix]);

  const handleRetryPolish = useCallback(() => {
    setPolishBannerDismissed(false);
    polishProgress.reset();
    polishProgress.polish(id);
  }, [polishProgress, id]);

  // Parse evidence images from current article
  const evidenceImages = useMemo(() => parseEvidenceImages(fullArticle), [fullArticle]);

  const wordCount = (fullArticle || '')
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter((w) => w).length;

  const currentSnapshot = useMemo(
    () => buildDraftSnapshot({
      title,
      headline,
      metaDescription,
      fullArticle,
      redFlags,
      faqs,
      verdict,
    }),
    [title, headline, metaDescription, fullArticle, redFlags, faqs, verdict]
  );
  const hasUnsavedChanges = !!lastSavedSnapshot && currentSnapshot !== lastSavedSnapshot;

  /* -- AEO Fix -- */
  const handleAeoFix = async (fixIds) => {
    setAeoFixing(true);
    setAeoFixingId(fixIds.length === 1 ? fixIds[0] : 'all');
    setSaveError('');
    try {
      const res = await fetch('/api/admin/aeo-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullArticle,
          title,
          keyword: review?.brand_name || brand?.name || '',
          metaDescription,
          fixes: fixIds,
          contentType: 'review',
        }),
      });
      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || 'Fix failed');
      if (data.fixedArticle) {
        setFullArticle(data.fixedArticle);
        setEditorKey(k => k + 1);
        setSyncMsg(`AEO fixes applied (${data.fixesApplied?.join(', ')}). Review & save.`);
        setTimeout(() => setSyncMsg(''), 6000);
      }
    } catch (e) {
      setSaveError(`AEO fix failed: ${e.message}`);
      setTimeout(() => setSaveError(''), 6000);
    } finally {
      setAeoFixing(false);
      setAeoFixingId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const sanitizedFullArticle = scrubVisualPlaceholders(fullArticle);
      const sanitizedRedFlags = scrubRedFlagsForSave(redFlags);
      const sanitizedFaqs = scrubFaqsForSave(faqs);
      const sanitizedVerdict = scrubVisualPlaceholders(verdict);
      const sanitizedWordCount = (sanitizedFullArticle || '')
        .replace(/<[^>]*>/g, ' ')
        .split(/\s+/)
        .filter((w) => w).length;
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
          full_article: sanitizedFullArticle,
          red_flags: sanitizedRedFlags,
          faq: sanitizedFaqs,
          verdict: sanitizedVerdict,
          word_count: sanitizedWordCount,
        }),
      });

      if (res.ok) {
        if (sanitizedFullArticle !== fullArticle) {
          setFullArticle(sanitizedFullArticle);
          setEditorKey(k => k + 1);
        }
        setRedFlags(sanitizedRedFlags);
        setFaqs(sanitizedFaqs);
        if (sanitizedVerdict !== verdict) setVerdict(sanitizedVerdict);
        const savedSnapshot = buildDraftSnapshot({
          title,
          headline,
          metaDescription,
          fullArticle: sanitizedFullArticle,
          redFlags: sanitizedRedFlags,
          faqs: sanitizedFaqs,
          verdict: sanitizedVerdict,
        });
        setSaved(true);
        setLastSavedSnapshot(savedSnapshot);
        setTimeout(() => setSaved(false), 2000);
        return true;
      } else {
        setSaveError('Failed to save. Try again.');
        setTimeout(() => setSaveError(''), 4000);
        return false;
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveError('Save failed: ' + (err.message || 'network error'));
      setTimeout(() => setSaveError(''), 4000);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishError('');
    setPublishIssues([]);
    setSyncMsg('');
    setPublishing(true);
    try {
      const saveOk = await handleSave();
      if (!saveOk) {
        setPublishError('Save failed. Fix errors before publishing.');
        return;
      }
      const res = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'publish' }),
      });

      if (res.ok) {
        const data = await res.json();
        setReview((r) => ({ ...r, status: 'published' }));
        setPublishIssues([]);
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
        const parsed = await parseAdminApiError(res, 'Publish failed');
        setPublishError(parsed.message);
        setPublishIssues(parsed.issues || []);
      }
    } catch (err) {
      setPublishError(err?.message || 'Network error while publishing');
    } finally {
      setPublishing(false);
    }
  };

  const handleAutoFixIssues = async (issuesToFix, republish = false, options = {}) => {
    if (!Array.isArray(issuesToFix) || issuesToFix.length === 0) return;
    setAutoFixing(true);
    setPublishError('');
    const citationFixMode = options?.citationFixMode === 'replace' ? 'replace' : 'remove';
    try {
      const res = await fetch(`/api/admin/reviews/${id}/auto-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ issues: issuesToFix, citation_fix_mode: citationFixMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Auto-fix failed (${res.status})`);
      }

      const appliedCount = Array.isArray(data.applied) ? data.applied.length : 0;
      const replacementCount = Array.isArray(data.applied)
        ? data.applied
            .filter((entry) => entry?.action === 'replace_with_vetted_source')
            .reduce((sum, entry) => sum + ((entry?.replaced_with || []).length || 0), 0)
        : 0;
      setSyncMsg(
        replacementCount > 0
          ? `✓ Auto-fix applied ${appliedCount} change${appliedCount === 1 ? '' : 's'} (${replacementCount} citation replacement${replacementCount === 1 ? '' : 's'})`
          : `✓ Auto-fix applied ${appliedCount} change${appliedCount === 1 ? '' : 's'}`
      );
      setPublishIssues([]);
      await fetchReview();
      if (republish) await handlePublish();
    } catch (err) {
      setPublishError(`Auto-fix failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setAutoFixing(false);
    }
  };

  const handleSyncToLive = async () => {
    setSyncing(true);
    setSyncMsg('');
    setSaveError('');
    try {
      const saveOk = await handleSave();
      if (!saveOk) {
        setSyncMsg('⚠ Save failed — not synced to live');
        return;
      }
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
    setPublishError('');
    setSyncMsg('');
    try {
      const res = await fetch(`/api/admin/reviews/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'unpublish' }),
      });
      if (res.ok) {
        const data = await res.json();
        setReview((r) => ({ ...r, status: 'draft' }));
        if (data.live_sync?.success) {
          setSyncMsg('✓ Unpublished and synced to live site');
          setTimeout(() => setSyncMsg(''), 5000);
        } else if (data.live_sync?.error) {
          setSyncMsg(`⚠ Unpublished, but live sync failed: ${data.live_sync.error}`);
        } else {
          setSyncMsg('⚠ Unpublished in admin; live sync status unavailable');
        }
      } else {
        const parsed = await parseAdminApiError(res, 'Failed to unpublish');
        setPublishError(parsed.message);
        setTimeout(() => setPublishError(''), 12000);
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
      const saveOk = await handleSave();
      if (!saveOk) {
        setImageMsg('Save failed — cannot regenerate images');
        return;
      }

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

  // ─── Midjourney Image Generation ───
  const handleGenerateImages = async () => {
    setGeneratingImages(true);
    setImageGenMsg('');
    setImageProgressMsg('Submitting to Midjourney...');
    try {
      // Start a timer to show progress messages
      let elapsed = 0;
      const progressInterval = setInterval(() => {
        elapsed += 5;
        if (elapsed < 15) {
          setImageProgressMsg('Submitting prompts to Midjourney...');
        } else if (elapsed < 40) {
          setImageProgressMsg(`Generating hero image... (${elapsed}s)`);
        } else if (elapsed < 80) {
          setImageProgressMsg(`Generating content images... (${elapsed}s)`);
        } else if (elapsed < 120) {
          setImageProgressMsg(`Compressing & uploading... (${elapsed}s)`);
        } else {
          setImageProgressMsg(`Still processing... (${elapsed}s)`);
        }
      }, 5000);

      const res = await fetch('/api/admin/images/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ review_id: id, content_count: 2 }),
      });

      clearInterval(progressInterval);
      setImageProgressMsg('');

      const data = await res.json();

      if (data.success) {
        const parts = [];
        if (data.hero) {
          const src = data.hero.source === 'midjourney' ? '✦ MJ' : '📷 Unsplash';
          parts.push(`Hero (${src})`);
        }
        if (data.content_images?.length) {
          parts.push(`${data.content_images.length} content image(s)`);
        }
        setImageGenMsg(`✓ Generated: ${parts.join(' + ') || 'no images'}`);

        // Show prompt used
        if (data.hero?.prompt) {
          console.log('[UI] MJ Hero prompt:', data.hero.prompt);
        }

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
        setImageGenMsg(`✗ ${data.error || 'Failed to generate images'}`);
      }
    } catch (err) {
      console.error('Image generation error:', err);
      setImageGenMsg(`✗ Error: ${err.message || 'network error'}`);
      setImageProgressMsg('');
    } finally {
      setGeneratingImages(false);
      setTimeout(() => setImageGenMsg(''), 8000);
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

  // The polish banner surfaces whenever phase B hasn't reached 'polished'. We
  // show it for:
  //   - polishing in flight (live SSE stream from useEffect)
  //   - polish errored (from SSE or from a watchdog sweep)
  //   - polish completed (so the 'done' step renders before fetchReview reruns)
  //   - polish_failed stored on the row (stale or watchdog-recovered)
  //   - content_generated stored on the row (phase A done, phase B never ran —
  //     author needs to click Retry so the SSE stream runs and lands visuals)
  //   - polishing stored on the row (orphan from a prior tab that got closed
  //     before the stream completed; click Retry to restart cleanly)
  //
  // We never show the banner once generation_status is 'polished' or when it
  // is null/undefined (legacy reviews predating the split pipeline).
  const unpolishedStates = new Set(['content_generated', 'polishing', 'polish_failed'])
  const reviewNeedsPolish = review.generation_status && unpolishedStates.has(review.generation_status)

  const showPolishBanner =
    !polishBannerDismissed &&
    (polishProgress.isPolishing ||
      polishProgress.error ||
      polishProgress.step === 'done' ||
      reviewNeedsPolish);

  const bannerStep = polishProgress.step || (
    review.generation_status === 'polish_failed' ? 'error'
      : review.generation_status === 'content_generated' ? 'ready'
      : review.generation_status === 'polishing' ? 'orphan'
      : ''
  );
  const bannerError = polishProgress.error || (
    review.generation_status === 'polish_failed' ? (review.polish_error || 'Polish failed') : null
  );
  const placeholderIssues = publishIssues.filter((issue) => issue?.code === 'UNRESOLVED_VISUAL_PLACEHOLDER');
  const citationIssues = publishIssues.filter((issue) => issue?.code === 'INVALID_CITATION_URL');

  return (
    <div className="space-y-4">
      {/* Phase-B polish banner (visuals + audit + hero images) */}
      {showPolishBanner && (
        <PolishProgressBanner
          progress={polishProgress.progress}
          step={bannerStep}
          message={polishProgress.message || review.polish_error || ''}
          error={bannerError}
          onRetry={handleRetryPolish}
          onDismiss={() => setPolishBannerDismissed(true)}
        />
      )}

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
          {hasUnsavedChanges && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-950/60 text-amber-300 border border-amber-700/40">
              Unsaved changes
            </span>
          )}
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

          {/* Polish — re-run visuals + quality audit + ad-evidence embedding
             WITHOUT regenerating the article text. Cheap (no writer LLM calls),
             and the way to (re)embed real scraped ad creatives after a content
             generate or a SpyOwl cookie refresh. */}
          <button
            onClick={() => { setPolishBannerDismissed(false); polishProgress.polish(id); }}
            disabled={polishProgress.isPolishing || gen.isGenerating}
            title="Re-run visuals, quality audit & ad-evidence embedding — without regenerating the article text (saves tokens)"
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-sky-600/10 text-sky-400 hover:bg-sky-600/20 border border-sky-600/20 transition disabled:opacity-50"
          >
            {polishProgress.isPolishing ? (
              <><span className="animate-spin">⟳</span> Polishing...</>
            ) : (
              <><span>✨</span> Polish</>
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

          {/* View Live — always visible next to Save. Active only when published;
             shown as disabled with a tooltip while the review is still a draft,
             so authors can see where it will live and reach it in one click
             once published. */}
          {review.slug && review.status === 'published' ? (
            <a
              href={`https://cryptokiller.org/review/${review.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the live review on cryptokiller.org"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-green-600/10 text-green-400 hover:bg-green-600/20 border border-green-600/20 transition flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              View Live
            </a>
          ) : (
            <button
              type="button"
              disabled
              title={review.slug
                ? `Not published yet — publish to make this link live at cryptokiller.org/review/${review.slug}`
                : 'Slug not set — save the review to assign one'}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-gray-800/40 text-gray-500 border border-gray-800 cursor-not-allowed flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              View Live
            </button>
          )}

          {/* Publish / Unpublish + Sync */}
          {review.status === 'published' ? (
            <>
              <button
                onClick={handleSyncToLive}
                disabled={syncing || hasUnsavedChanges}
                title={hasUnsavedChanges ? 'Save changes before syncing to live' : undefined}
                className={`text-sm font-medium px-4 py-2 rounded-lg border transition flex items-center gap-1.5 ${
                  syncing || hasUnsavedChanges
                    ? 'bg-gray-800/40 text-gray-500 border-gray-800 cursor-not-allowed'
                    : 'bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border-blue-600/20'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? 'Syncing...' : hasUnsavedChanges ? 'Save to Sync' : 'Sync to Live'}
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
        <div className="py-2 px-3 bg-red-900/20 border border-red-600/30 rounded-lg text-red-400 text-sm max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
          {publishError || saveError}
        </div>
      )}

      {publishIssues.length > 0 && (
        <div className="bg-amber-900/15 border border-amber-600/30 rounded-lg p-3 space-y-3">
          <p className="text-sm text-amber-300 font-medium">
            Auto-fix options for publish gate
          </p>
          <div className="space-y-2">
            {publishIssues.map((issue, idx) => (
              <div key={`${issue.code || 'ISSUE'}-${idx}`} className="text-xs text-amber-200/90 bg-black/20 rounded p-2">
                <span className="font-semibold">{issue.code || 'ISSUE'}</span>
                {issue.field ? ` in ${issue.field}` : ''}
                {issue.url ? ` — ${issue.url}` : ''}
                {issue.reason ? ` (${issue.reason})` : ''}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {placeholderIssues.length > 0 && (
              <button
                onClick={() => handleAutoFixIssues(placeholderIssues, false)}
                disabled={autoFixing}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600/15 text-blue-300 hover:bg-blue-600/25 border border-blue-500/30 transition"
              >
                Remove placeholders only
              </button>
            )}
            {citationIssues.length > 0 && (
              <button
                onClick={() => handleAutoFixIssues(citationIssues, false)}
                disabled={autoFixing}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600/15 text-blue-300 hover:bg-blue-600/25 border border-blue-500/30 transition"
              >
                Remove invalid citations only
              </button>
            )}
            {citationIssues.length > 0 && (
              <button
                onClick={() => handleAutoFixIssues(citationIssues, false, { citationFixMode: 'replace' })}
                disabled={autoFixing}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-green-600/15 text-green-300 hover:bg-green-600/25 border border-green-500/30 transition"
              >
                Replace invalid citations (vetted)
              </button>
            )}
            <button
              onClick={() => handleAutoFixIssues(publishIssues, false)}
              disabled={autoFixing}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600/15 text-amber-300 hover:bg-amber-600/25 border border-amber-500/30 transition"
            >
              {autoFixing ? 'Fixing…' : 'Auto-fix all issues'}
            </button>
            <button
              onClick={() => handleAutoFixIssues(publishIssues, true)}
              disabled={autoFixing || publishing}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-500/30 transition"
            >
              {autoFixing ? 'Fixing…' : 'Auto-fix and republish'}
            </button>
          </div>
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
          <TranslationsCard
            reviewId={review.id}
            masterSlug={review.slug}
            masterUpdatedAt={review.updated_at}
            token={token}
          />
          <MidjourneyImagesCard
            review={review}
            generating={generatingImages}
            message={imageGenMsg}
            progressMsg={imageProgressMsg}
            onGenerate={handleGenerateImages}
          />
          <EvidenceImagesCard
            images={evidenceImages}
            onRemoveImage={handleRemoveImage}
            onRegenerate={handleRegenerateImages}
            regenerating={regeneratingImages}
          />
          <BrandIntelCard brand={brand} />
          {/* SEO & AEO Audit */}
          <SeoAeoAudit
            contentType="review"
            title={title}
            headline={headline}
            metaDescription={metaDescription}
            fullArticle={fullArticle}
            slug={review?.slug || ''}
            keyword={review?.brand_name || brand?.name || ''}
            sections={[]}
            faq={faqs || []}
            sources={review?.sources || []}
            internalLinks={review?.internal_links || []}
            heroImage={review?.hero_image_url || ''}
            heroImageAlt={review?.hero_image_alt || ''}
            wordCount={wordCount}
            redFlags={redFlags}
            verdict={verdict}
            onFix={handleAeoFix}
            fixing={aeoFixing}
            fixingId={aeoFixingId}
          />
        </div>
      </div>
    </div>
  );
}
