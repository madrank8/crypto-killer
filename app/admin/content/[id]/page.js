'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useAdmin } from '@/lib/admin-context';

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

  /* -- Publish -- */
  const publishAction = async (action) => {
    setPublishing(true);
    setError('');
    setMsg('');
    try {
      await save();
      const res = await fetch(`/api/admin/content/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${action} failed`);

      setContent((prev) => ({ ...prev, status: data.status, published_at: data.published_at }));
      if (data.live_sync?.success) {
        setMsg(`\u2713 Published & synced to live site`);
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

  /* -- Manual sync to live site -- */
  const [syncing, setSyncing] = useState(false);
  const syncToLive = async () => {
    setSyncing(true);
    setError('');
    setMsg('');
    try {
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
              <TipTapEditor key={phase + '-' + (content?.id || '')} content={fullArticle} onChange={setFullArticle} />
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
