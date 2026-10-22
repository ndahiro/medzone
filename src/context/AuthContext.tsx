/**
 * MedZone session context (mirrors the elgon AuthContext pattern).
 *
 * Holds the currently authenticated user, exposes login/logout, and answers
 * module-access questions for the sidebar. Session state is rehydrated from
 * the backend on mount via GET /api/me (httpOnly cookie session).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ManagedUser, ModuleKey } from '../types/auth';
import { getSessionUser, loginUser as apiLogin, logoutUser as apiLogout } from '../lib/auth';

interface AuthContextValue {
  user: ManagedUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  canAccess: (module: ModuleKey) => boolean;
  /** Clinical role of the signed-in user (defaults to patient when unknown). */
  effectiveRole: 'patient' | 'clinician' | 'admin';
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ManagedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await getSessionUser();
      if (active) {
        if (session) setUser(session);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await apiLogin(username, password);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  }, []);

  const canAccess = useCallback(
    (module: ModuleKey) => {
      if (!user) return false;
      if (user.isAdmin) return true;
      return (user.modules || []).includes(module);
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: !!user?.isAdmin,
      loading,
      login,
      logout,
      canAccess,
      effectiveRole: user?.role ?? 'patient',
    }),
    [user, loading, login, logout, canAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
