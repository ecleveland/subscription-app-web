'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setLabels([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setLabels(await listLabels(true));
    } catch (err) {
      // Keep last-known labels on a transient failure.
      setError(err instanceof Error ? err.message : 'Failed to load labels');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

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
