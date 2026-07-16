'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const AdminContext = createContext();

// Cheap client-side expiry check for the signed session token
// (`cks1.<expiryMs>.<sig>`). We don't verify the signature here (the server
// does that on every request) — we only avoid keeping an obviously-expired
// token around. A non-session token (e.g. a pasted raw secret) is treated as
// non-expiring.
function isExpiredSessionToken(token) {
  if (typeof token !== 'string') return true;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'cks1') return false;
  const exp = Number(parts[1]);
  return !Number.isFinite(exp) || Date.now() > exp;
}

export function AdminProvider({ children }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check sessionStorage on mount
    if (typeof window !== 'undefined') {
      const storedToken = sessionStorage.getItem('admin_token');
      if (storedToken && !isExpiredSessionToken(storedToken)) {
        setToken(storedToken);
      } else if (storedToken) {
        // Drop an expired session token so the app falls back to the login
        // screen on load instead of firing 401s with a stale token — no
        // silent dead-end after the token ages out.
        sessionStorage.removeItem('admin_token');
      }
      setLoading(false);
    }
  }, []);

  const logout = () => {
    setToken(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('admin_token');
    }
  };

  const value = {
    token,
    setToken,
    logout,
    loading,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within AdminProvider');
  }
  return context;
}
