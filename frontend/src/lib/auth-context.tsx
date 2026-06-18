'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setAccessToken, clearStoredAuth } from './api';
import type { User } from './types';

interface UserInfo {
  userId: string;
  username: string;
  role: 'user' | 'admin';
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isHydrated: boolean;
  user: UserInfo | null;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (data: {
    username: string;
    password: string;
    displayName?: string;
    email?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function parseJwt(token: string): {
  sub: string;
  username: string;
  role: string;
} {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join(''),
  );
  return JSON.parse(jsonPayload);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start with false/null to match server render, then hydrate from localStorage
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  // Hydrate auth state from localStorage after mount — must use setState in effect
  // because localStorage is not available during SSR
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true); // eslint-disable-line react-hooks/set-state-in-effect
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser) as UserInfo);
        } catch {
          localStorage.removeItem('user');
        }
      }
    }
    setHydrated(true);
  }, []);

  const fetchAndStoreProfile = useCallback(
    async (tokenPayload: { sub: string; username: string; role: string }) => {
      try {
        const profile = await apiFetch<User>('/users/me');
        const userInfo: UserInfo = {
          userId: tokenPayload.sub,
          username: tokenPayload.username,
          role: tokenPayload.role as 'user' | 'admin',
          displayName: profile.displayName,
          email: profile.email,
          avatarUrl: profile.avatarUrl,
        };
        localStorage.setItem('user', JSON.stringify(userInfo));
        setUser(userInfo);
      } catch {
        const userInfo: UserInfo = {
          userId: tokenPayload.sub,
          username: tokenPayload.username,
          role: tokenPayload.role as 'user' | 'admin',
        };
        localStorage.setItem('user', JSON.stringify(userInfo));
        setUser(userInfo);
      }
    },
    [],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        throw new Error('Invalid credentials');
      }

      const data = await res.json();
      setAccessToken(data.access_token);
      setIsAuthenticated(true);

      const payload = parseJwt(data.access_token);
      await fetchAndStoreProfile(payload);
      router.push('/');
    },
    [router, fetchAndStoreProfile],
  );

  const register = useCallback(
    async (data: {
      username: string;
      password: string;
      displayName?: string;
      email?: string;
    }) => {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Registration failed');
      }

      const responseData = await res.json();
      setAccessToken(responseData.access_token);
      setIsAuthenticated(true);

      const payload = parseJwt(responseData.access_token);
      await fetchAndStoreProfile(payload);
      router.push('/');
    },
    [router, fetchAndStoreProfile],
  );

  const logout = useCallback(async () => {
    const token = localStorage.getItem('token');

    // Best-effort backend logout: revokes the refresh token (sent via the
    // httpOnly cookie) and bumps tokenVersion to invalidate access tokens.
    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
      } catch {
        // Ignore errors — we're logging out anyway
      }
    }

    clearStoredAuth();
    setIsAuthenticated(false);
    setUser(null);
    router.push('/login');
  }, [router]);

  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const payload = parseJwt(token);
    await fetchAndStoreProfile(payload);
  }, [fetchAndStoreProfile]);

  const contextValue = useMemo(
    () => ({
      isAuthenticated,
      isHydrated: hydrated,
      user,
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
      refreshProfile,
    }),
    [isAuthenticated, hydrated, user, login, register, logout, refreshProfile],
  );

  // Always render children (mirrors ThemeProvider) so the app isn't blanked
  // during hydration — avoids the flash/CLS/SEO hit of returning null. Auth-
  // dependent UI gates on `isAuthenticated`/`isHydrated` instead (e.g. Header
  // returns null when unauthenticated).
  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
