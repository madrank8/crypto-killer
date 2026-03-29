'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const AdminContext = createContext();

export function AdminProvider({ children }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check sessionStorage on mount
    if (typeof window !== 'undefined') {
      const storedToken = sessionStorage.getItem('admin_token');
      if (storedToken) {
        setToken(storedToken);
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
