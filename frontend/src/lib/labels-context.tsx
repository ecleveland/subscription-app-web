'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-context';
import { listLabels } from './labels';
import type { Label } from './types';

interface LabelsContextType {
  // Archived labels included, so history keeps its chips.
  labels: Label[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const LabelsContext = createContext<LabelsContextType | null>(null);

export function LabelsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isHydrated } = useAuth();
  const pathname = usePathname();
  const [labels, setLabels] = useState<Label[]>([]);
  // True until the first fetch after auth hydrates settles, so consumers
  // never read "loaded, no labels" from the pre-hydration signed-out default.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Each call takes a number. Only the latest call writes state, so a fetch
  // still in flight at logout, or overtaken by a newer one, is dropped.
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!isHydrated) return;
    if (!isAuthenticated) {
      setLabels([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await listLabels(true);
      if (request === latestRequest.current) setLabels(next);
    } catch (err) {
      // Keep last-known labels on a transient failure.
      if (request === latestRequest.current) {
        setError(err instanceof Error ? err.message : 'Failed to load labels');
      }
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [isAuthenticated, isHydrated]);

  // Pages create labels through their own calls, so refetch on navigation.
  // That is how the Business nav item appears after the first label is made
  // on another page. The list is a handful of rows.
  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  const value = useMemo(
    () => ({ labels, loading, error, refresh }),
    [labels, loading, error, refresh],
  );

  return (
    <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>
  );
}

export function useLabels() {
  const context = useContext(LabelsContext);
  if (!context) {
    throw new Error('useLabels must be used within a LabelsProvider');
  }
  return context;
}
