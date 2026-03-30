'use client';

import { useAdmin } from '@/lib/admin-context';
import { useState, useEffect, useCallback } from 'react';

export default function SettingsPage() {
  const { token } = useAdmin();
  const [cookieInput, setCookieInput] = useState('');
  const [status, setStatus] = useState(null); // { ok, message, ... }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setStatus(data.spyowl_cookie);
    } catch (e) {
      setStatus({ status: { ok: false, message: e.message } });
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSave = async () => {
    if (!cookieInput.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key: 'spyowl_cookie', value: cookieInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveResult(data.verification);
        setCookieInput('');
        // Refresh status
        await fetchStatus();
      } else {
        setSaveResult({ ok: false, message: data.error || 'Failed to save' });
      }
    } catch (e) {
      setSaveResult({ ok: false, message: e.message });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-1">Manage API integrations and credentials</p>
      </div>

      {/* SpyOwl Connection Card */}
      <div className="bg-gray-900/50 border border-gray-800/60 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-600/20 border border-purple-600/30 flex items-center justify-center">
              <span className="text-lg">🦉</span>
            </div>
            <div>
              <h2 className="text-white font-semibold">SpyOwl Connection</h2>
              <p className="text-gray-500 text-sm">Required for evidence grid images in reviews</p>
            </div>
          </div>

          {/* Status Badge */}
          {!loading && status && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
              status.status?.ok
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              <div className={`w-2 h-2 rounded-full ${status.status?.ok ? 'bg-green-400' : 'bg-red-400'}`} />
              {status.status?.ok ? 'Connected' : 'Disconnected'}
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400">
              <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
              Checking...
            </div>
          )}
        </div>

        {/* Status Details */}
        {status && (
          <div className="bg-gray-800/40 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Status</span>
              <span className={status.status?.ok ? 'text-green-400' : 'text-red-400'}>
                {status.status?.message || 'Unknown'}
              </span>
            </div>
            {status.set && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Cookie length</span>
                  <span className="text-gray-300">{status.length} chars</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Last updated</span>
                  <span className="text-gray-300">
                    {status.updated_at ? new Date(status.updated_at).toLocaleString() : 'Never'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4 space-y-3">
          <h3 className="text-blue-300 font-medium text-sm">How to refresh your SpyOwl token</h3>
          <ol className="text-gray-400 text-sm space-y-1.5 list-decimal list-inside">
            <li>Open <a href="https://app.spyowl.icu" target="_blank" rel="noopener" className="text-blue-400 hover:underline">app.spyowl.icu</a> and make sure you&apos;re logged in</li>
            <li>Open DevTools (F12) → Application → Cookies → api.spyowl.icu</li>
            <li>Click <strong className="text-gray-200">__Secure-spyowl.session_token</strong> and copy the <strong className="text-gray-200">Value</strong></li>
          </ol>
          <p className="text-gray-500 text-xs mt-2">Just the token value — the cookie name is added automatically.</p>
        </div>

        {/* Cookie Input */}
        <div className="space-y-3">
          <label className="text-sm text-gray-300 font-medium">Paste session token value</label>
          <textarea
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            placeholder="oYF9YHzpPbWKx3ighqo8kql..."
            rows={2}
            className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 font-mono"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !cookieInput.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition"
            >
              {saving ? 'Verifying...' : 'Save & Verify'}
            </button>
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition"
            >
              Refresh Status
            </button>
          </div>

          {/* Save Result */}
          {saveResult && (
            <div className={`flex items-center gap-2 text-sm ${saveResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {saveResult.ok ? '✓' : '✗'} {saveResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
