'use client';

import { useState, useEffect, useCallback } from 'react';

/* ─── Step icons for visual flair ─── */
const STEP_ICONS = {
  brand: '🎯',
  creatives: '📸',
  images: '🖼️',
  ai: '🧠',
  ai_done: '✅',
  building: '🔨',
  saving: '💾',
  done: '🚀',
  error: '❌',
};

const STEP_LABELS = {
  brand: 'Loading brand intelligence',
  creatives: 'Fetching ad creatives',
  images: 'Checking evidence images',
  ai: 'Claude AI generating review',
  ai_done: 'Parsing AI response',
  building: 'Building HTML + schema',
  saving: 'Saving to database',
  done: 'Complete',
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
