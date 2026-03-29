'use client';

import { AdminProvider, useAdmin } from '@/lib/admin-context';
import { useState } from 'react';
import Link from 'next/link';

function AdminAuthGate({ children }) {
  const { token, setToken, loading } = useAdmin();
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        setLoginError('Invalid password');
        setLoginLoading(false);
        return;
      }

      const data = await res.json();
      sessionStorage.setItem('admin_token', data.token);
      setToken(data.token);
      setPassword('');
    } catch (err) {
      setLoginError('Error logging in');
      setLoginLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-dark-bg flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="h-screen bg-dark-bg flex items-center justify-center">
        <div className="w-full max-w-md px-6">
          <div className="card bg-dark-card border-gray-700">
            <h1 className="text-3xl font-bold text-white mb-2">Admin Panel</h1>
            <p className="text-gray-400 mb-8">Crypto Killer Administration</p>

            <form onSubmit={handleLogin}>
              <div className="mb-4">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="search-input w-full"
                  disabled={loginLoading}
                />
              </div>

              {loginError && (
                <div className="mb-4 p-3 bg-red-900 bg-opacity-20 border border-red-500 rounded text-red-400 text-sm">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="btn btn-primary w-full"
              >
                {loginLoading ? 'Authenticating...' : 'Enter Admin'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Admin Header */}
      <div className="border-b border-gray-700 bg-dark-surface">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Crypto Killer Admin</h1>
          <div className="flex gap-6">
            <Link
              href="/admin"
              className="text-gray-300 hover:text-white transition"
            >
              Dashboard
            </Link>
            <button
              onClick={() => {
                sessionStorage.removeItem('admin_token');
                window.location.reload();
              }}
              className="text-gray-400 hover:text-gray-300 transition text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Page Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </div>
    </div>
  );
}

export default function AdminLayout({ children }) {
  return (
    <AdminProvider>
      <AdminAuthGate>{children}</AdminAuthGate>
    </AdminProvider>
  );
}
