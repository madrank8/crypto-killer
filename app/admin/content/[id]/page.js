'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAdmin } from '@/lib/admin-context';
import SeoAeoAudit from '@/components/SeoAeoAudit';

const TipTapEditor = dynamic(() => import('@/components/TipTapEditor'), { ssr: false });

/* -- Phase detection --
 * full_article populated -> 'article'
 * sections has items     -> 'outline'
 * else                   -> 'empty'
 */
function detectPhase(content) {
  if (content?.full_article && content.full_article.trim().length > 0) return 'article';
  if (Array.isArray(content?.sections) && content.sections.length > 0) return 'outline';
  return 'empty';
}

function sectionsToHtml(sections = []) {
  return (sections || [])
    .map((s) => {
      const body = String(s.body || '')
      // If body contains HTML block elements (figure, div, img), render as-is
      if (/<(figure|div|img)\b/i.test(body)) {
        const blocks = body.split(/\n{2,}/)
        const rendered = blocks.map(block => {
          if (/<(figure|div|img)\b/i.test(block)) return block
          return `<p>${block.replace(/\n/g, '<br/>')}</p>`
        }).join('\n')
        return `<h2>${s.heading || 'Section'}</h2>\n${rendered}`
      }
      return `<h2>${s.heading || 'Section'}</h2><p>${body.replace(/\n+/g, '<br/>')}</p>`
    })
    .join('\n\n')
}

/* -- SSE reader helper -- */
async function runSSE(url, token, body, { onProgress, onComplete, onError }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${res.status}`);
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
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          onError?.(data.message || 'Generation failed');
        } else if (data.step === 'done') {
          onComplete?.(data);
        } else {
          onProgress?.(data);
        }
      } catch {
        /* ignore malformed lines */
      }
    }
  }
}

/* -- Step indicator -- */
function StepIndicator({ currentPhase }) {
  const steps = [
    { key: 'empty', label: 'Start' },
    { key: 'outline', label: 'Outline' },
    { key: 'article', label: 'Article' },
  ];
  const idx = steps.findIndex((s) => s.key === currentPhase);

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1.5">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i <= idx
                ? 'bg-red-600 text-white'
                : 'bg-gray-800 text-gray-500 border border-gray-700'
            }`}
          >
            {i < idx ? '\u2713' : i + 1}
          </div>
          <span className={`text-xs font-medium ${i <= idx ? 'text-white' : 'text-gray-600'}`}>
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div className={`h-px w-6 ${i < idx ? 'bg-red-600' : 'bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/* -- Progress modal -- */
function ProgressModal({ open, step, progress, message, error, onClose }) {
  if (!open) return null;
  const canClose = error || step === 'done';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
        <h3 className="text-white font-semibold text-lg">
          {error ? 'Generation failed' : step === 'done' ? 'Complete' : 'Generating\u2026'}
        </h3>
        <p className="text-gray-500 text-sm mt-1">{message}</p>
        <div className="mt-4 h-2 bg-dark-bg rounded-full overflow-hidden border border-gray-800">
          <div
            className={`h-full rounded-full transition-all ${error ? 'bg-red-500' : 'bg-red-600'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {canClose && (
          <button
            type="button"
            className="mt-4 w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-white"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

/* -- Section card (outline editing) -- */
function SectionCard({ section, index, total, onUpdate, onRemove, onMove }) {
  const [editing, setEditing] = useState(false);
  const [heading, setHeading] = useState(section.heading || '');
  const [description, setDescription] = useState(section.description || '');
  const [keyPoints, setKeyPoints] = useState(section.key_points || []);

  const save = () => {
    onUpdate(index, { ...section, heading, description, key_points: keyPoints.filter(Boolean) });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4 space-y-3">
        <input
          className="search-input w-full text-sm font-semibold"
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          placeholder="Section heading"
        />
        <textarea
          className="search-input w-full text-sm min-h-[68px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Section description / what it will cover"
        />
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Key Points</label>
          {keyPoints.map((kp, i) => (
            <div key={i} className="flex gap-2 mt-1">
              <input
                className="search-input flex-1 text-sm"
                value={kp}
                onChange={(e) => {
                  const up = [...keyPoints];
                  up[i] = e.target.value;
                  setKeyPoints(up);
                }}
                placeholder={`Point ${i + 1}`}
              />
              <button
                type="button"
                className="text-red-400 hover:text-red-300 text-xs px-2"
                onClick={() => setKeyPoints(keyPoints.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-blue-400 hover:text-blue-300 mt-2"
            onClick={() => setKeyPoints([...keyPoints, ''])}
          >
            + Add point
          </button>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={save} className="text-sm px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">{section.heading}</p>
          <p className="text-xs text-gray-500 mt-1">{section.description}</p>
          {section.key_points?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {section.key_points.map((kp, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                  {kp}
                </span>
              ))}
            </div>
          )}
          {section.target_word_count && (
            <p className="text-[10px] text-gray-600 mt-1">~{section.target_word_count} words</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-blue-400 hover:text-blue-300">
            Edit
          </button>
          <button type="button" onClick={() => onMove(index, 'up')} disabled={index === 0} className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-30">
            \u2191
          </button>
          <button type="button" onClick={() => onMove(index, 'down')} disabled={index === total - 1} className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-30">
            \u2193
          </button>
          <button type="button" onClick={() => onRemove(index)} className="text-xs text-red-500 hover:text-red-400">
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/* -- FAQ card (outline editing) -- */
function FaqCard({ item, index, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(item.question || '');
  const [answer, setAnswer] = useState(item.answer || item.answer_hint || '');

  const save = () => {
    onUpdate(index, { question, answer });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-3 space-y-2">
        <input
          className="search-input w-full text-sm"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="FAQ question"
        />
        <textarea
          className="search-input w-full text-sm min-h-[56px]"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Answer or hint"
        />
        <div className="flex gap-2">
          <button type="button" onClick={save} className="text-sm px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-3 flex items-start justify-between gap-2">
      <div className="flex-1">
        <p className="text-sm text-white">{item.question}</p>
        <p className="text-xs text-gray-500 mt-0.5">{item.answer || item.answer_hint || '\u2014'}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-blue-400 hover:text-blue-300">
          Edit
        </button>
        <button type="button" onClick={() => onRemove(index)} className="text-xs text-red-500 hover:text-red-400">
          Remove
        </button>
      </div>
    </div>
  );
}

/* SeoChecklist replaced by shared SeoAeoAudit component */

/* ====================================================
 *  Main Content Editor Page
 * ==================================================== */
export default function ContentEditorPage({ params }) {
  const { id } = params;
  const { token } = useAdmin();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // Structured payload from the publish quality gate (422). Holds the
  // reasons[] list so the user sees exactly which checks failed instead of
  // a single opaque "Publish blocked by quality gate" string.
  const [publishGate, setPublishGate] = useState(null);
  const [fixingQuality, setFixingQuality] = useState(false);
  const fixingQualityRef = useRef(false);
  const [qualityFixReport, setQualityFixReport] = useState(null);
  const [aeoFixing, setAeoFixing] = useState(false);
  const [aeoFixingId, setAeoFixingId] = useState(null);
  const [editorKey, setEditorKey] = useState(0);

  const [content, setContent] = useState(null);
  const [topic, setTopic] = useState(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [fullArticle, setFullArticle] = useState('');
  const [sections, setSections] = useState([]);
  const [faq, setFaq] = useState([]);

  // Phase override: user can go "Back to Outline" from article
  const [forcePhase, setForcePhase] = useState(null);

  // Image regeneration
  const [regeneratingImages, setRegeneratingImages] = useState(false);
  const [imageMsg, setImageMsg] = useState('');

  // SSE progress modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState('');
  const [modalProgress, setModalProgress] = useState(0);
  const [modalMessage, setModalMessage] = useState('');
  const [modalError, setModalError] = useState(null);

  const wordCount = useMemo(
    () => String(fullArticle || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length,
    [fullArticle]
  );

  const phase = forcePhase || detectPhase({ ...content, full_article: fullArticle, sections });

  /* -- Load content -- */
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
        setSections(Array.isArray(data.sections) ? data.sections : []);
        setFaq(Array.isArray(data.faq) ? data.faq : []);
        setFullArticle(data.full_article || '');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, id]);

  /* -- Reload content from server -- */
  const reloadContent = async () => {
    try {
      const res = await fetch(`/api/admin/content/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Failed to reload content. Try refreshing the page.');
        return;
      }
      const data = await res.json();
      setContent(data);
      setTopic(data.topic || null);
      setTitle(data.title || '');
      setHeadline(data.headline || '');
      setMetaDescription(data.meta_description || '');
      setSections(Array.isArray(data.sections) ? data.sections : []);
      setFaq(Array.isArray(data.faq) ? data.faq : []);
      setFullArticle(data.full_article || '');
      setForcePhase(null);
      setError('');
    } catch (e) {
      setError('Reload failed: ' + (e.message || 'network error'));
    }
  };

  /* -- Save -- */
  const save = async () => {
    setSaving(true);
    setError('');
    setMsg('');
    try {
      const payload = {
        title,
        headline,
        meta_description: metaDescription,
        updated_at: new Date().toISOString(),
      };

      // Save based on what phase has data
      if (fullArticle && fullArticle.trim()) {
        payload.full_article = fullArticle;
        payload.word_count = wordCount;
      }
      if (sections.length > 0) {
        payload.sections = sections;
      }
      if (faq.length > 0) {
        payload.faq = faq;
      }

      const res = await fetch(`/api/admin/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
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

  /* -- Publish / Unpublish --
     `override:true` ships past the quality gate (the operator's escape hatch,
     re-POSTed from the gate panel after the reasons are shown). The server
     records the bypassed reasons on the row for a durable trail. */
  const publishAction = async (action, { override = false } = {}) => {
    setPublishing(true);
    setError('');
    setMsg('');
    setPublishGate(null);
    try {
      await save();
      const res = await fetch(`/api/admin/content/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...(override ? { override: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Quality gate (422) returns a structured payload — surface every
        // reason as a bullet so the user knows exactly what to fix.
        if (res.status === 422 && Array.isArray(data?.reasons) && data.reasons.length > 0) {
          setPublishGate({
            action,
            error: data.error || 'Publish blocked by quality gate',
            reasons: data.reasons,
            dead_sources: Array.isArray(data.dead_sources) ? data.dead_sources : [],
            overridable: data.overridable !== false,
            ai_model: data.ai_model || null,
            slug: data.slug || null,
          });
          return;
        }
        throw new Error(data.error || `${action} failed`);
      }

      setContent((prev) => ({ ...prev, status: data.status, published_at: data.published_at }));

      const overNote = data.overridden ? ' (published via override — gate bypassed)' : '';
      if (action === 'publish') {
        // sync_ok is the honest signal: the DB flip can succeed while the live
        // site never received the article. Offer a Re-sync when that happens.
        if (data.sync_ok) {
          setMsg('\u2713 Published & synced to live site' + overNote);
        } else {
          setMsg(`\u26a0 Published${overNote}, but LIVE SYNC FAILED: ${data.sync_error || data.live_sync?.error || 'unknown'}. Click "Sync to Live" to retry \u2014 the live site is stale until it succeeds.`);
        }
      } else {
        if (data.live_sync?.success) {
          setMsg('\u2713 Unpublished & removed from live site');
        } else {
          setMsg('\u2713 Unpublished (live site may still show cached version)');
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  /* -- Drop dead citation(s) & retry publish (no AI regeneration) --
     A dead/404 source is a ledger problem, not a prose problem — regenerating
     the whole article to clear it wastes time and tokens. This removes the
     offending source (and any matching citation) from the row via a plain
     PATCH, then re-runs the publish gate. */
  const removeDeadSourcesAndRetry = async () => {
    const deadUrls = new Set((publishGate?.dead_sources || []).map((d) => d.url).filter(Boolean));
    if (deadUrls.size === 0) return;
    setPublishing(true);
    setError('');
    setMsg('');
    try {
      const newSources = (content.sources || []).filter((s) => !deadUrls.has(s?.url));
      const patch = { sources: newSources };
      const hasCitations = Array.isArray(content.citations);
      const newCitations = hasCitations
        ? content.citations.filter((c) => !deadUrls.has(c?.url))
        : null;
      if (hasCitations) patch.citations = newCitations;

      const res = await fetch(`/api/admin/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to remove dead source');
      }

      setContent((prev) => ({
        ...prev,
        sources: newSources,
        ...(hasCitations ? { citations: newCitations } : {}),
      }));
      setPublishGate(null);
      // Re-run the publish gate against the cleaned ledger.
      await publishAction('publish');
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  /* -- Re-run ONLY the quality auditor (cheap recovery) --
     When the gate blocks on "quality audit did not complete", regenerating the
     whole article can time out again. This re-runs just the auditor, then
     retries publish if a verdict was produced. */
  const rerunAuditAndRetry = async () => {
    setPublishing(true);
    setError('');
    setMsg('Re-running quality audit…');
    try {
      const res = await fetch(`/api/admin/content/${id}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Re-audit failed');
      if (data.audit_status !== 'ok') {
        setMsg(`Auditor still failing (${data.audit_error || 'no verdict'}). Retry, or use "Publish anyway" to override.`);
        return;
      }
      // Name the judge: if the cross-vendor model was unavailable this silently
      // fell back to Claude, which grades its own family more leniently.
      setMsg(`✓ Audit complete — ${data.overall_score ?? '?'}/100 (judge: ${data.audit_model || 'unknown'}). Retrying publish…`);
      setPublishGate(null);
      await publishAction('publish');
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  /* -- Quality Fix Agent: safe auto-fixes → reaudit → publish if hard fails clear -- */
  const fixAndPublish = async () => {
    if (!token || !id) return;
    if (fixingQualityRef.current || fixingQuality) return; // ignore double-clicks (two in-flight runs race-wipe body)
    fixingQualityRef.current = true;
    setFixingQuality(true);
    setQualityFixReport(null);
    setError('');
    setMsg('Running quality fix…');
    try {
      await save();
      const res = await fetch(`/api/admin/content/${id}/quality-fix`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_publish: true }),
      });
      if (!res.ok || !res.body) throw new Error('Quality fix failed to start');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let final = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.step === 'done' || data.step === 'needs_review' || data.step === 'error') {
              final = data;
            } else if (data.message) {
              setMsg(data.message);
            }
          } catch {
            /* ignore malformed SSE lines */
          }
        }
      }
      setQualityFixReport(final);
      if (final?.published) {
        setPublishGate(null);
        setMsg('Published after quality fix');
        await reloadContent();
      } else if (final?.step === 'error') {
        setError(final.message || 'Quality fix failed');
        setMsg('');
      } else if (final) {
        // needs_review — keep gate open, reload so editor shows applied patches
        setMsg(final.message || 'Quality fix finished — still needs review before publish');
        await reloadContent();
      } else {
        setError('Quality fix returned no result');
        setMsg('');
      }
    } catch (e) {
      setError(e.message);
      setMsg('');
    } finally {
      fixingQualityRef.current = false;
      setFixingQuality(false);
    }
  };

  /* -- Manual sync to live site -- */
  const [syncing, setSyncing] = useState(false);
  const syncToLive = async () => {
    setSyncing(true);
    setError('');
    setMsg('');
    try {
      // Save latest edits first so the live site gets current content
      await save();
      const res = await fetch(`/api/admin/content/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMsg('\u2713 Synced to live site');
      } else {
        setError(`Sync failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      setError(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  /* -- AEO Fix -- */
  const handleAeoFix = async (fixIds) => {
    setAeoFixing(true);
    setAeoFixingId(fixIds.length === 1 ? fixIds[0] : 'all');
    setError('');
    try {
      const res = await fetch('/api/admin/aeo-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullArticle,
          title,
          keyword: topic?.target_keyword || '',
          metaDescription,
          fixes: fixIds,
          contentType: 'content',
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
        setMsg(`AEO fixes applied (${data.fixesApplied?.join(', ')}). Review & save.`);
        setTimeout(() => setMsg(''), 6000);
      }
    } catch (e) {
      setError(`AEO fix failed: ${e.message}`);
    } finally {
      setAeoFixing(false);
      setAeoFixingId(null);
    }
  };

  /* -- Regenerate images -- */
  const [imageProgress, setImageProgress] = useState({ step: '', percent: 0 });
  const regenerateImages = async (mode = 'all', target = '') => {
    setRegeneratingImages(true);
    setImageMsg('');
    setError('');

    // Faster progress steps for single image mode
    const isSingle = mode === 'single';
    const steps = isSingle
      ? [
          { step: `Regenerating ${target === 'hero' ? 'hero' : 'section'} image...`, percent: 20, delay: 1000 },
          { step: 'Generating with AI...', percent: 50, delay: 5000 },
          { step: 'Compressing & uploading...', percent: 75, delay: 10000 },
          { step: 'Almost done...', percent: 90, delay: 20000 },
        ]
      : [
          { step: 'Saving edits...', percent: 5, delay: 2000 },
          { step: 'Generating AI search queries...', percent: 10, delay: 4000 },
          { step: 'Sending to image generator...', percent: 15, delay: 6000 },
          { step: 'Creating hero image...', percent: 25, delay: 10000 },
          { step: 'Section images generating in parallel...', percent: 45, delay: 20000 },
          { step: 'Compressing images...', percent: 65, delay: 30000 },
          { step: 'Uploading to storage...', percent: 75, delay: 40000 },
          { step: 'Embedding in article...', percent: 85, delay: 50000 },
          { step: 'Wrapping up...', percent: 90, delay: 55000 },
        ];
    setImageProgress(steps[0]);

    const timers = steps.slice(1).map(s =>
      setTimeout(() => setImageProgress({ step: s.step, percent: s.percent }), s.delay)
    );

    try {
      await save();
      setImageProgress({ step: isSingle ? 'Generating...' : 'Generating AI prompts...', percent: 15 });

      const res = await fetch(`/api/admin/content/${id}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode, ...(target ? { target } : {}) }),
      });
      timers.forEach(t => clearTimeout(t));

      let data;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) throw new Error(res.status === 504 ? 'Server timed out — images may still be processing. Try again in a minute.' : text || `HTTP ${res.status}`);
        data = { results: {} };
      }
      if (!res.ok) throw new Error(data.error || 'Image generation failed');

      setImageProgress({ step: 'Done!', percent: 100 });

      const parts = [];
      if (data.results?.stock?.success && data.results.stock.hero) {
        parts.push(`Hero: "${data.results.stock.queries?.heroQuery || 'generated'}"`);
        if (data.results.stock.contentImages > 0) {
          parts.push(`${data.results.stock.contentImages} section images`);
        }
      }
      if (data.results?.stock && !data.results.stock.success) {
        parts.push(`Stock failed: ${data.results.stock.error || 'unknown'}`);
      }
      if (data.results?.visuals?.success && data.results.visuals.total > 0) {
        parts.push(`${data.results.visuals.succeeded}/${data.results.visuals.total} AI visuals`);
      }
      if (data.results?.refresh?.success) {
        if (data.results.refresh.refreshed > 0) {
          parts.push(`${data.results.refresh.refreshed} visual(s) refreshed`);
        } else {
          parts.push('No visuals found to refresh');
        }
        if (data.results.refresh.failed > 0) {
          parts.push(`${data.results.refresh.failed} failed`);
        }
      }
      if (data.results?.single?.success) {
        const t = data.results.single.target === 'hero' ? 'Hero' : `Section ${parseInt(data.results.single.target?.replace('content-',''),10)+1}`;
        parts.push(`${t} image regenerated (${data.results.single.source || 'AI'})`);
      }
      if (data.results?.single && !data.results.single.success) {
        parts.push(`Single image failed: ${data.results.single.error || 'unknown'}`);
      }

      setImageMsg(parts.length > 0 ? `\u2713 ${parts.join(' \u00b7 ')}` : 'No images generated');
      await reloadContent();
    } catch (e) {
      timers.forEach(t => clearTimeout(t));
      setImageProgress({ step: '', percent: 0 });
      setError(`Image generation failed: ${e.message}`);
    } finally {
      setRegeneratingImages(false);
      setTimeout(() => {
        setImageMsg('');
        setImageProgress({ step: '', percent: 0 });
      }, 8000);
    }
  };

  /* -- Generate outline (SSE) -- */
  const generateOutline = async () => {
    setModalOpen(true);
    setModalStep('init');
    setModalProgress(0);
    setModalMessage('Starting outline generation\u2026');
    setModalError(null);

    try {
      await runSSE('/api/admin/content/outline', token, { content_id: id }, {
        onProgress: (data) => {
          if (typeof data.progress === 'number') setModalProgress(data.progress);
          if (data.step) setModalStep(data.step);
          if (data.message) setModalMessage(data.message);
        },
        onComplete: async (data) => {
          setModalStep('done');
          setModalProgress(100);
          setModalMessage(data.message || 'Outline ready.');
          await reloadContent();
        },
        onError: (msg) => {
          setModalError(msg);
          setModalStep('error');
        },
      });
    } catch (e) {
      setModalError(e.message);
      setModalStep('error');
    }
  };

  /* -- Generate full article (SSE) -- */
  const generateArticle = async () => {
    // Save current outline edits first
    await save();

    setModalOpen(true);
    setModalStep('init');
    setModalProgress(0);
    setModalMessage('Starting article generation\u2026');
    setModalError(null);

    try {
      await runSSE('/api/admin/content/fill', token, { content_id: id }, {
        onProgress: (data) => {
          if (typeof data.progress === 'number') setModalProgress(data.progress);
          if (data.step) setModalStep(data.step);
          if (data.message) setModalMessage(data.message);
        },
        onComplete: async (data) => {
          setModalStep('done');
          setModalProgress(100);
          setModalMessage(data.message || 'Article ready.');
          await reloadContent();
        },
        onError: (msg) => {
          setModalError(msg);
          setModalStep('error');
        },
      });
    } catch (e) {
      setModalError(e.message);
      setModalStep('error');
    }
  };

  /* -- Outline section/FAQ editing helpers -- */
  const updateSection = (index, updated) => {
    setSections((prev) => prev.map((s, i) => (i === index ? updated : s)));
  };

  const removeSection = (index) => {
    setSections((prev) => prev.filter((_, i) => i !== index));
  };

  const moveSection = (index, direction) => {
    setSections((prev) => {
      const arr = [...prev];
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      { heading: 'New Section', description: '', target_word_count: 180, key_points: [] },
    ]);
  };

  const updateFaq = (index, updated) => {
    setFaq((prev) => prev.map((f, i) => (i === index ? updated : f)));
  };

  const removeFaq = (index) => {
    setFaq((prev) => prev.filter((_, i) => i !== index));
  };

  const addFaq = () => {
    setFaq((prev) => [...prev, { question: '', answer: '' }]);
  };

  /* -- Loading / error states -- */
  if (loading) return <div className="text-gray-500 text-sm">Loading content...</div>;
  if (error && !content) return <div className="text-red-400 text-sm">{error}</div>;
  if (!content) return <div className="text-gray-500 text-sm">Content not found</div>;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/topical-map" className="text-gray-500 hover:text-gray-300">
            \u2190
          </Link>
          <h1 className="text-lg font-bold text-white">Content Editor</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs ${content.status === 'published' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {content.status}
          </span>
          <StepIndicator currentPhase={phase} />
        </div>
        <div className="flex items-center gap-2">
          {phase === 'article' && (
            <>
            <button
              type="button"
              onClick={() => setForcePhase('outline')}
              className="text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white"
            >
              \u2190 Back to Outline
            </button>
            <button
              type="button"
              onClick={generateArticle}
              className="text-xs px-3 py-2 rounded-lg border border-amber-500/30 text-amber-300 hover:text-white hover:border-amber-400/60"
            >
              Regenerate Article
            </button>
            </>
          )}
          {phase === 'outline' && forcePhase === 'outline' && fullArticle && (
            <button
              type="button"
              onClick={() => setForcePhase(null)}
              className="text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white"
            >
              View Article \u2192
            </button>
          )}
          <button onClick={save} disabled={saving || publishing} className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white">
            {saving ? 'Saving...' : msg === 'Saved' ? 'Saved' : 'Save'}
          </button>
          {phase === 'article' && (
            content.status === 'published' ? (
              <>
                <a
                  href={`https://cryptokiller.org/blog/${content.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm px-3 py-2 rounded-lg bg-green-600/10 text-green-400 hover:bg-green-600/20 border border-green-600/20 transition flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Live Post
                </a>
                <button
                  onClick={syncToLive}
                  disabled={syncing || publishing}
                  className="text-sm px-3 py-2 rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-600/20 transition flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {syncing ? 'Syncing...' : 'Sync to Live'}
                </button>
                <button onClick={() => publishAction('unpublish')} disabled={publishing || saving} className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white">
                  {publishing ? 'Working...' : 'Unpublish'}
                </button>
              </>
            ) : (
              <button onClick={() => publishAction('publish')} disabled={publishing || saving} className="text-sm px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white">
                {publishing ? 'Publishing...' : 'Publish to /blog'}
              </button>
            )
          )}
        </div>
      </div>

      {/* Messages */}
      {(error || msg) && (
        <div className={`text-sm rounded-lg px-3 py-2 ${error ? 'bg-red-900/20 border border-red-600/30 text-red-400' : 'bg-green-900/20 border border-green-600/30 text-green-400'}`}>
          {error || msg}
        </div>
      )}

      {/* Publish quality gate failure — renders the structured reasons[]
          payload returned by /api/admin/content/[id]/publish (422). Without
          this, the user only saw the bare 'Publish blocked by quality gate'
          string and had no idea what to fix. Each reason maps to a specific
          gate check (deterministic-fallback ai_model, skeleton openers,
          taxonomy trailers, short sections, placeholder internal links,
          author-name stutter). */}
      {publishGate && (
        <div className="rounded-lg border border-amber-600/40 bg-amber-900/10 px-4 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-300">
                {publishGate.error}
              </p>
              <p className="text-xs text-amber-200/70 mt-0.5">
                {publishGate.reasons.length} {publishGate.reasons.length === 1 ? 'check' : 'checks'} failed
                {publishGate.ai_model ? (
                  <>
                    {' '}&middot;{' '}
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40 border border-amber-700/40">
                      ai_model: {publishGate.ai_model}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPublishGate(null)}
              className="text-xs text-amber-300/60 hover:text-amber-200 px-2"
              title="Dismiss"
            >
              ✕
            </button>
          </div>

          <ul className="text-xs text-amber-100/90 space-y-1 list-disc pl-5">
            {publishGate.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2 pt-1">
            {/* Token-free recovery for dead citations: drop the offending
                source(s) from the ledger and re-run the gate. A 404 URL is a
                data problem, not a prose problem — no regeneration needed. */}
            {Array.isArray(publishGate.dead_sources) && publishGate.dead_sources.length > 0 && (
              <button
                type="button"
                onClick={removeDeadSourcesAndRetry}
                disabled={publishing || saving}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                title={publishGate.dead_sources.map((d) => d.url).join('\n')}
              >
                {publishing
                  ? 'Removing…'
                  : `Remove dead source${publishGate.dead_sources.length > 1 ? 's' : ''} & retry`}
              </button>
            )}
            {/* Single-click recovery: most quality-gate failures (especially
                ai_model='deterministic-fallback' and taxonomy-trailer hits)
                are fixed by re-running the writer. */}
            <button
              type="button"
              onClick={() => {
                setPublishGate(null);
                generateArticle();
              }}
              disabled={publishing || saving}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
            >
              Regenerate Article
            </button>
            <button
              type="button"
              onClick={() => {
                setPublishGate(null);
                setForcePhase('outline');
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-600/30 text-amber-200 hover:text-white hover:border-amber-500/60"
            >
              Edit Outline First
            </button>
            {/* Cheap recovery for "quality audit did not complete": re-run
                only the auditor (no full regeneration, which can time out
                again) then retry the gate. */}
            {publishGate.reasons.some((r) => /quality audit did not complete/i.test(r)) && (
              <button
                type="button"
                onClick={rerunAuditAndRetry}
                disabled={publishing || saving}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {publishing ? 'Auditing…' : 'Re-run Audit'}
              </button>
            )}
            <button
              type="button"
              onClick={fixAndPublish}
              disabled={publishing || saving || fixingQuality}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              title="Applies safe automatic fixes, re-runs the audit, and publishes only if hard fails clear."
            >
              {fixingQuality ? 'Fixing…' : 'Fix & Publish'}
            </button>
            {/* Escape hatch — never trapped. Ships past the gate, recording the
                bypassed reasons on the row. Deliberately styled as a
                last-resort, not a primary action. */}
            {publishGate.overridable && publishGate.action === 'publish' && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(
                    'Publish anyway, bypassing the quality gate?\n\nThe blocked reasons will be recorded on this article for the audit trail. Only do this if you have manually verified the content is safe to publish.'
                  )) {
                    publishAction('publish', { override: true });
                  }
                }}
                disabled={publishing || saving || fixingQuality}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-700/60 text-red-300 hover:text-white hover:bg-red-700/40 disabled:opacity-50"
                title="Bypass the quality gate and publish. Records the bypassed reasons on the row."
              >
                Publish anyway (override)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quality Fix Agent report — applied (green) / unfixable (amber) */}
      {qualityFixReport && (Array.isArray(qualityFixReport.applied) || Array.isArray(qualityFixReport.unfixable)) && (
        <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 px-4 py-3 space-y-3">
          <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
            Quality fix report
            {qualityFixReport.published ? (
              <span className="ml-2 normal-case font-normal text-green-400">· published</span>
            ) : qualityFixReport.step === 'needs_review' ? (
              <span className="ml-2 normal-case font-normal text-amber-400">· needs review</span>
            ) : null}
          </p>
          {Array.isArray(qualityFixReport.applied) && qualityFixReport.applied.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-green-400 font-medium">Applied ({qualityFixReport.applied.length})</p>
              <ul className="text-xs text-green-300/90 space-y-1 list-disc pl-5">
                {qualityFixReport.applied.map((item, i) => (
                  <li key={i}>
                    <span className="font-mono text-[10px] text-green-500/80">{item.key || 'fix'}</span>
                    {item.what ? ` — ${item.what}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(qualityFixReport.unfixable) && qualityFixReport.unfixable.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-amber-400 font-medium">
                {qualityFixReport.human_only || qualityFixReport.step === 'needs_review'
                  ? 'Unfixable — human only'
                  : `Unfixable (${qualityFixReport.unfixable.length})`}
              </p>
              <ul className="text-xs text-amber-200/90 space-y-1.5 list-disc pl-5">
                {qualityFixReport.unfixable.map((item, i) => (
                  <li key={i}>
                    <span className="font-mono text-[10px] text-amber-500/80">{item.key || 'unknown'}</span>
                    {item.reason ? ` — ${item.reason}` : ''}
                    {item.operator_action ? (
                      <span className="block text-amber-300/80 mt-0.5 pl-0">
                        Operator: {item.operator_action}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!qualityFixReport.applied?.length && !qualityFixReport.unfixable?.length) && (
            <p className="text-xs text-gray-500">No fixes applied.</p>
          )}
          {(qualityFixReport.human_only || (qualityFixReport.step === 'needs_review' && !qualityFixReport.published)) && (
            <p className="text-xs text-red-300/90 border-t border-gray-800/60 pt-2">
              Readiness loop finished without a publishable draft. Edit the named claims above — do not use publish override.
            </p>
          )}
        </div>
      )}

      {/* ======== PHASE: EMPTY ======== */}
      {phase === 'empty' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-8 text-center">
              <div className="text-4xl mb-3">\ud83d\udcdd</div>
              <h2 className="text-lg font-semibold text-white mb-2">Ready to create content</h2>
              <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                Generate an outline first \u2014 you can review, edit sections, add FAQ topics, and reorder before writing the full article.
              </p>
              <button
                type="button"
                onClick={generateOutline}
                className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition"
              >
                Generate Outline
              </button>
            </div>
          </div>

          {/* Topic intel sidebar */}
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">Topic Intel</h3>
              <p className="text-sm text-white">{topic?.title || '\u2014'}</p>
              <p className="text-xs text-gray-500">Keyword: {topic?.target_keyword || '\u2014'}</p>
              <p className="text-xs text-gray-500">Volume: {topic?.search_volume ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">KD: {topic?.keyword_difficulty ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">Priority: {topic?.priority_score ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">Type: {topic?.content_type?.replace(/_/g, ' ') || '\u2014'}</p>
            </div>
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
              <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-1">Slug</h3>
              <p className="text-sm text-gray-300 font-mono">{content.slug}</p>
            </div>
          </div>
        </div>
      )}

      {/* ======== PHASE: OUTLINE ======== */}
      {phase === 'outline' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-4">
            {/* Title / headline / meta */}
            <div className="space-y-2">
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
                className="search-input w-full min-h-[56px]"
              />
            </div>

            {/* Sections */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">
                  Sections ({sections.length})
                </h2>
                <button
                  type="button"
                  onClick={addSection}
                  className="text-xs px-3 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                >
                  + Add section
                </button>
              </div>
              <div className="space-y-2">
                {sections.map((s, i) => (
                  <SectionCard
                    key={i}
                    section={s}
                    index={i}
                    total={sections.length}
                    onUpdate={updateSection}
                    onRemove={removeSection}
                    onMove={moveSection}
                  />
                ))}
              </div>
            </div>

            {/* FAQ */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">
                  FAQ Topics ({faq.length})
                </h2>
                <button
                  type="button"
                  onClick={addFaq}
                  className="text-xs px-3 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                >
                  + Add FAQ
                </button>
              </div>
              <div className="space-y-2">
                {faq.map((f, i) => (
                  <FaqCard key={i} item={f} index={i} onUpdate={updateFaq} onRemove={removeFaq} />
                ))}
              </div>
            </div>

            {/* Generate article CTA */}
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-center">
              <p className="text-gray-500 text-sm mb-3">
                Happy with the outline? Save your edits and generate the full article.
              </p>
              <button
                type="button"
                onClick={generateArticle}
                className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition"
              >
                Generate Article \u2192
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">Topic Intel</h3>
              <p className="text-sm text-white">{topic?.title || '\u2014'}</p>
              <p className="text-xs text-gray-500">Keyword: {topic?.target_keyword || '\u2014'}</p>
              <p className="text-xs text-gray-500">Volume: {topic?.search_volume ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">KD: {topic?.keyword_difficulty ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">Priority: {topic?.priority_score ?? '\u2014'}</p>
            </div>

            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">Outline Stats</h3>
              <p className="text-sm text-white">{sections.length} sections</p>
              <p className="text-xs text-gray-500">
                ~{sections.reduce((s, sec) => s + (sec.target_word_count || 180), 0)} target words
              </p>
              <p className="text-xs text-gray-500">{faq.length} FAQ items</p>
              <p className="text-xs text-gray-500">Slug: {content.slug}</p>
            </div>

            {content.sources?.length > 0 && (
              <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Sources</h3>
                <ul className="space-y-1">
                  {content.sources.slice(0, 8).map((s, i) => (
                    <li key={i} className="text-xs text-gray-400 truncate">
                      <span className="text-[10px] text-gray-600 mr-1">[{s.type}]</span>
                      {s.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======== PHASE: ARTICLE ======== */}
      {phase === 'article' && (
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
              <TipTapEditor key={phase + '-' + (content?.id || '') + '-' + editorKey} content={fullArticle} onChange={setFullArticle} />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">Topic Intel</h3>
              <p className="text-sm text-white">{topic?.title || '\u2014'}</p>
              <p className="text-xs text-gray-500">Keyword: {topic?.target_keyword || '\u2014'}</p>
              <p className="text-xs text-gray-500">Volume: {topic?.search_volume ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">KD: {topic?.keyword_difficulty ?? '\u2014'}</p>
              <p className="text-xs text-gray-500">Priority: {topic?.priority_score ?? '\u2014'}</p>
            </div>

            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">Quality</h3>
              <div className="flex items-baseline justify-between">
                <p className="text-sm text-white">{wordCount.toLocaleString()} words</p>
                {content.ai_audit?.overall_score && (
                  <span className={`text-sm font-semibold ${
                    content.ai_audit.overall_score >= 80 ? 'text-green-400' :
                    content.ai_audit.overall_score >= 60 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {content.ai_audit.overall_score}/100
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">{sections.length} sections \u00b7 {faq.length} FAQ items</p>
              <p className="text-xs text-gray-500 font-mono truncate">{content.slug}</p>
              {content.ai_model && (
                <p className="text-xs text-gray-600">Model: {content.ai_model}</p>
              )}
            </div>

            {/* Images card */}
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-wide text-gray-500">Images</h3>
                {imageMsg && (
                  <span className="text-[10px] text-green-400 truncate max-w-[180px]">{imageMsg}</span>
                )}
              </div>

              {/* Hero image preview */}
              {content.hero_image_url ? (
                <div className="group relative space-y-1">
                  <img
                    src={content.hero_image_url}
                    alt={content.hero_image_alt || 'Hero'}
                    className="w-full h-24 object-cover rounded-lg border border-gray-700"
                  />
                  <button
                    onClick={() => regenerateImages('single', 'hero')}
                    disabled={regeneratingImages}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-white hover:bg-indigo-600 disabled:opacity-50"
                    title="Regenerate hero image"
                  >
                    ↻ Hero
                  </button>
                  <p className="text-[10px] text-gray-600 truncate">{content.hero_image_credit || ''}</p>
                </div>
              ) : (
                <div className="w-full h-20 rounded-lg border-2 border-dashed border-gray-700 flex items-center justify-center">
                  <span className="text-xs text-gray-600">No hero image</span>
                </div>
              )}

              {/* Content images with individual regenerate */}
              {content.content_images?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Section Images</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {content.content_images.map((img, i) => (
                      <div key={i} className="group relative">
                        <img
                          src={img.url}
                          alt={img.alt || `Section ${i + 1}`}
                          className="w-full h-16 object-cover rounded border border-gray-700"
                        />
                        <button
                          onClick={() => regenerateImages('single', `content-${i}`)}
                          disabled={regeneratingImages}
                          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition text-[8px] px-1 py-0.5 rounded bg-black/70 text-white hover:bg-indigo-600 disabled:opacity-50"
                          title={`Regenerate section ${i + 1} image`}
                        >
                          ↻
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Visual meta stats */}
              {content.visual_meta?.length > 0 && (
                <p className="text-xs text-gray-500">
                  {content.visual_meta.filter(v => v.succeeded).length}/{content.visual_meta.length} AI visuals rendered
                </p>
              )}

              {/* Image generation progress */}
              {regeneratingImages && imageProgress.step && (
                <div className="space-y-1.5">
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-1000 ease-out"
                      style={{ width: `${imageProgress.percent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-indigo-300 animate-pulse">{imageProgress.step}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => regenerateImages('all')}
                  disabled={regeneratingImages}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 border border-indigo-600/20 transition disabled:opacity-50"
                >
                  {regeneratingImages ? 'Generating\u2026' : '\ud83d\uddbc\ufe0f Regenerate All Images'}
                </button>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => regenerateImages('stock')}
                    disabled={regeneratingImages}
                    className="flex-1 text-[10px] px-2 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition disabled:opacity-50"
                  >
                    Stock Only
                  </button>
                  <button
                    onClick={() => regenerateImages('visuals')}
                    disabled={regeneratingImages}
                    className="flex-1 text-[10px] px-2 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition disabled:opacity-50"
                  >
                    AI Visuals Only
                  </button>
                </div>
                <button
                  onClick={() => regenerateImages('refresh')}
                  disabled={regeneratingImages}
                  className="w-full text-[10px] px-2 py-1.5 rounded-lg border border-emerald-600/20 text-emerald-400 hover:bg-emerald-600/10 hover:border-emerald-500/30 transition disabled:opacity-50"
                >
                  {regeneratingImages ? 'Refreshing\u2026' : '\u2728 Refresh Visuals (fix diagrams/charts)'}
                </button>
              </div>
            </div>

            {/* SEO & AEO Audit */}
            <SeoAeoAudit
              contentType="content"
              title={title}
              headline={headline}
              metaDescription={metaDescription}
              fullArticle={fullArticle}
              slug={content.slug || ''}
              keyword={topic?.target_keyword || ''}
              sections={sections || []}
              faq={faq || []}
              sources={content.sources || []}
              internalLinks={content.internal_links || []}
              heroImage={content.hero_image_url || ''}
              heroImageAlt={content.hero_image_alt || ''}
              wordCount={wordCount}
              onFix={handleAeoFix}
              fixing={aeoFixing}
              fixingId={aeoFixingId}
            />

            {content.summary && (
              <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Summary</h3>
                <p className="text-xs text-gray-300 leading-relaxed">{content.summary}</p>
              </div>
            )}

            <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
              <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Internal Links</h3>
              <ul className="space-y-1 text-xs text-gray-400">
                {(content.internal_links || []).slice(0, 8).map((l, i) => (
                  <li key={i}>\u2022 {l.anchor_text || l.target_topic || 'Link'}</li>
                ))}
                {(!content.internal_links || content.internal_links.length === 0) && <li>No links yet</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SSE Progress Modal */}
      <ProgressModal
        open={modalOpen}
        step={modalStep}
        progress={modalProgress}
        message={modalMessage}
        error={modalError}
        onClose={() => {
          setModalOpen(false);
          setModalError(null);
        }}
      />
    </div>
  );
}
