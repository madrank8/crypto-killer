'use client';

import { useState, useEffect, useCallback } from 'react';

/* ─── Step icons for visual flair ─── */
const STEP_ICONS = {
  // Phase A: /generate
  brand: '🎯',
  creatives: '📸',
  images: '🖼️',
  sources: '🔎',
  sources_fallback: '📚',
  ai: '🧠',
  ai_done: '✅',
  building: '🔨',
  saving: '💾',
  // Phase B: /polish
  polish_load: '📦',
  visuals: '🎨',
  visuals_done: '✅',
  visuals_skip: '⏭️',
  visuals_error: '⚠️',
  audit: '🔍',
  audit_done: '✅',
  audit_retry: '🔁',
  audit_skip: '⏭️',
  images_done: '✅',
  images_warn: '⚠️',
  images_skip: '⏭️',
  // Terminal
  done: '🚀',
  error: '❌',
};

const STEP_LABELS = {
  brand: 'Loading brand intelligence',
  creatives: 'Fetching ad creatives',
  images: 'Checking evidence images',
  sources: 'Researching sources',
  sources_fallback: 'Using fallback sources',
  ai: 'Claude AI generating review',
  ai_done: 'Parsing AI response',
  building: 'Building HTML + schema',
  saving: 'Saving to database',
  done: 'Complete',
  error: 'Error',
};

// Separate timeline for phase B so the overlay shows the polish story, not both.
const POLISH_STEP_LABELS = {
  polish_load: 'Loading draft',
  visuals: 'Resolving visual placeholders',
  audit: 'Quality audit',
  images: 'Hero & content images',
  saving: 'Saving polished review',
  done: 'Polish complete',
  error: 'Error',
};

/* ─── Pulsing dots for the AI thinking phase ─── */
function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5 ml-1">
      <span className="animate-bounce [animation-delay:0ms] w-1 h-1 rounded-full bg-purple-400 inline-block" />
      <span className="animate-bounce [animation-delay:150ms] w-1 h-1 rounded-full bg-purple-400 inline-block" />
      <span className="animate-bounce [animation-delay:300ms] w-1 h-1 rounded-full bg-purple-400 inline-block" />
    </span>
  );
}

/* ─── Main Progress Overlay ─── */
export function GenerateProgressOverlay({ progress, step, message, error, onClose }) {
  const isAiThinking = step === 'ai';
  const isDone = step === 'done';
  const isError = !!error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-card border border-gray-700 rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">{STEP_ICONS[step] || '⟳'}</span>
          <div>
            <h3 className="text-white font-bold text-lg">
              {isDone ? 'Review Generated' : isError ? 'Generation Failed' : 'Generating Review'}
            </h3>
            <p className="text-gray-500 text-sm">
              {isDone
                ? 'AI review is ready for your review'
                : isError
                  ? 'Something went wrong'
                  : 'seo-blog v3.1 + schema + ICP pipeline'
              }
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">{message}</span>
            <span className={`text-sm font-mono font-bold ${isError ? 'text-red-400' : isDone ? 'text-green-400' : 'text-purple-400'}`}>
              {progress}%
            </span>
          </div>
          <div className="h-2.5 bg-dark-bg rounded-full overflow-hidden border border-gray-800">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                isError
                  ? 'bg-red-500'
                  : isDone
                    ? 'bg-green-500'
                    : 'bg-gradient-to-r from-purple-600 via-purple-500 to-purple-400'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Step Timeline */}
        <div className="space-y-1.5 mb-6">
          {Object.keys(STEP_LABELS).filter(s => s !== 'error').map((s) => {
            const stepOrder = Object.keys(STEP_LABELS).indexOf(s);
            const currentOrder = Object.keys(STEP_LABELS).indexOf(step);
            const isCompleted = stepOrder < currentOrder || step === 'done';
            const isCurrent = s === step;
            const isPending = stepOrder > currentOrder;

            if (isPending && stepOrder > currentOrder + 2) return null;

            return (
              <div key={s} className={`flex items-center gap-2.5 py-1 px-2 rounded-lg transition-all duration-300 ${
                isCurrent ? 'bg-purple-600/10 border border-purple-600/20' : ''
              }`}>
                <span className={`text-sm w-5 text-center ${
                  isCompleted ? 'text-green-400' : isCurrent ? 'text-purple-400' : 'text-gray-700'
                }`}>
                  {isCompleted ? '✓' : isCurrent ? STEP_ICONS[s] : '○'}
                </span>
                <span className={`text-sm ${
                  isCompleted ? 'text-gray-500' : isCurrent ? 'text-white font-medium' : 'text-gray-700'
                }`}>
                  {STEP_LABELS[s]}
                  {isCurrent && isAiThinking && <ThinkingDots />}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error Message */}
        {isError && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-600/30 rounded-lg">
            <p className="text-red-400 text-sm">{message}</p>
          </div>
        )}

        {/* Action Buttons */}
        {(isDone || isError) && (
          <button
            onClick={onClose}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
              isDone
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-dark-surface hover:bg-dark-bg text-gray-300 border border-gray-700'
            }`}
          >
            {isDone ? 'View Review →' : 'Close'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Inline Progress Bar (for dashboard cards) ─── */
export function GenerateProgressInline({ progress, step, message, error }) {
  const isDone = step === 'done';
  const isError = !!error;
  const isAiThinking = step === 'ai';

  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm">{STEP_ICONS[step] || '⟳'}</span>
        <span className="text-xs text-gray-400 flex-1 truncate">
          {message}
          {isAiThinking && <ThinkingDots />}
        </span>
        <span className={`text-xs font-mono font-bold ${isError ? 'text-red-400' : isDone ? 'text-green-400' : 'text-purple-400'}`}>
          {progress}%
        </span>
      </div>
      <div className="h-1.5 bg-dark-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-purple-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Banner variant for phase-B polish (fits above the editor) ─── */
export function PolishProgressBanner({ progress, step, message, error, onRetry, onDismiss }) {
  const isDone = step === 'done';
  const isError = !!error;
  const isIdle = !step;
  if (isIdle) return null;

  const label = POLISH_STEP_LABELS[step] || message || 'Polishing review';

  return (
    <div className={`rounded-xl border px-4 py-3 mb-4 ${
      isError
        ? 'bg-red-950/30 border-red-600/40'
        : isDone
          ? 'bg-green-950/30 border-green-600/40'
          : 'bg-purple-950/20 border-purple-600/30'
    }`}>
      <div className="flex items-center gap-3">
        <span className="text-lg">
          {isError ? '❌' : isDone ? '✅' : (STEP_ICONS[step] || '⟳')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <span className={`text-sm font-medium truncate ${
              isError ? 'text-red-300' : isDone ? 'text-green-300' : 'text-purple-200'
            }`}>
              {isError ? 'Polish failed' : isDone ? 'Polish complete — review is ready' : label}
            </span>
            <span className={`text-xs font-mono ${
              isError ? 'text-red-400' : isDone ? 'text-green-400' : 'text-purple-400'
            }`}>
              {progress}%
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{message}</p>
          <div className="h-1 bg-dark-bg rounded-full overflow-hidden mt-2">
            <div
              className={`h-full transition-all duration-500 ${
                isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-purple-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {(isError || isDone) && (
          <div className="flex items-center gap-2 shrink-0">
            {isError && onRetry && (
              <button
                onClick={onRetry}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition"
              >
                Retry polish
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Hook: usePolishWithProgress (phase B) ─── */
export function usePolishWithProgress(token) {
  const [isPolishing, setIsPolishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = useCallback(() => {
    setIsPolishing(false);
    setProgress(0);
    setStep('');
    setMessage('');
    setError(null);
    setResult(null);
  }, []);

  const polish = useCallback(async (reviewId) => {
    if (!reviewId) return;
    reset();
    setIsPolishing(true);
    setProgress(2);
    setStep('polish_load');
    setMessage('Starting polish phase…');

    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/polish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            setProgress(data.progress);
            setStep(data.step);
            setMessage(data.message);
            if (data.error) setError(data.message);
            if (data.result) setResult(data.result);
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      setError(err.message);
      setStep('error');
      setMessage(err.message);
      setProgress(0);
    } finally {
      setIsPolishing(false);
    }
  }, [token, reset]);

  return { isPolishing, progress, step, message, error, result, polish, reset };
}

/* ─── Hook: useGenerateWithProgress ─── */
export function useGenerateWithProgress(token) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = useCallback(() => {
    setIsGenerating(false);
    setProgress(0);
    setStep('');
    setMessage('');
    setError(null);
    setResult(null);
  }, []);

  const generate = useCallback(async (brandId) => {
    reset();
    setIsGenerating(true);
    setProgress(2);
    setStep('brand');
    setMessage('Starting review generation...');

    try {
      const res = await fetch('/api/admin/reviews/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_id: brandId }),
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

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              setProgress(data.progress);
              setStep(data.step);
              setMessage(data.message);

              if (data.error) {
                setError(data.message);
              }
              if (data.result) {
                setResult(data.result);
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      }
    } catch (err) {
      setError(err.message);
      setStep('error');
      setMessage(err.message);
      setProgress(0);
    }
  }, [token, reset]);

  return { isGenerating, progress, step, message, error, result, generate, reset };
}
