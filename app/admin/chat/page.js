'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useRef } from 'react';

export default function AgentChatPage() {
  const { token } = useAdmin();
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [queueMsg, setQueueMsg] = useState(null);
  const bottomRef = useRef(null);

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  async function loadThreads() {
    const res = await fetch('/api/admin/agent/threads', { headers: headers() });
    const data = await res.json();
    if (res.ok) setThreads(data.threads || []);
  }

  async function openThread(id) {
    setThreadId(id);
    setSuggested([]);
    setError(null);
    const res = await fetch(`/api/admin/agent/threads/${id}`, { headers: headers() });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to load thread');
      return;
    }
    setMessages(
      (data.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        suggested: m.citations_json?.suggested_actions || [],
      }))
    );
  }

  useEffect(() => {
    if (token) loadThreads().catch(() => {});
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setQueueMsg(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      const res = await fetch('/api/admin/agent/chat', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ message: text, thread_id: threadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat failed');
      setThreadId(data.thread_id);
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.reply, suggested: data.suggested_actions || [] },
      ]);
      setSuggested(data.suggested_actions || []);
      loadThreads();
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function queueAction(a) {
    setQueueMsg(null);
    try {
      const res = await fetch('/api/admin/work-plan', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          title: a.title,
          action_type: a.action_type || 'other',
          target: a.target,
          why: a.why,
          priority: a.priority || 'P2',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Queue failed');
      setQueueMsg(`Queued: ${a.title}`);
    } catch (e) {
      setQueueMsg(e.message);
    }
  }

  function newChat() {
    setThreadId(null);
    setMessages([]);
    setSuggested([]);
    setError(null);
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)] min-h-[480px]">
      <aside className="w-56 shrink-0 flex flex-col gap-2 overflow-y-auto">
        <button
          type="button"
          onClick={newChat}
          className="text-sm px-3 py-2 rounded-lg bg-red-600/20 text-red-300 border border-red-600/30 hover:bg-red-600/30"
        >
          New chat
        </button>
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => openThread(t.id)}
            className={`text-left text-xs px-3 py-2 rounded-lg border truncate ${
              threadId === t.id
                ? 'border-red-600/40 bg-red-600/10 text-white'
                : 'border-gray-800 text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t.title || 'Untitled'}
          </button>
        ))}
      </aside>

      <div className="flex-1 flex flex-col rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h1 className="text-lg font-semibold text-white">Growth agent</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Grounded on live snapshot. Suggests only — never publishes from chat.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-500">
              Ask about CTR opportunities, hot brands without reviews, work-plan status, or a specific slug.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'ml-auto bg-red-600/20 text-gray-100 border border-red-600/30'
                  : 'bg-gray-800/80 text-gray-200 border border-gray-700'
              }`}
            >
              {m.content}
              {m.role === 'assistant' && m.suggested?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.suggested.map((a, j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => queueAction(a)}
                      className="block w-full text-left text-xs px-2 py-1.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-600/30 hover:bg-emerald-600/30"
                    >
                      Queue: {a.title} ({a.priority || 'P2'})
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-xs text-gray-500">Thinking…</p>}
          <div ref={bottomRef} />
        </div>

        {(error || queueMsg) && (
          <div className={`px-4 py-2 text-xs border-t border-gray-800 ${error ? 'text-red-400' : 'text-emerald-400'}`}>
            {error || queueMsg}
          </div>
        )}

        {suggested.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-800 flex flex-wrap gap-2">
            {suggested.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => queueAction(a)}
                className="text-xs px-2 py-1 rounded bg-emerald-600/15 text-emerald-300 border border-emerald-600/25"
              >
                Queue: {a.title}
              </button>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-gray-800 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask the growth agent…"
            className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-red-500/50"
          />
          <button
            type="button"
            disabled={busy || !input.trim()}
            onClick={send}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-40 hover:bg-red-500"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
