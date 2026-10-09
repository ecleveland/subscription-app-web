'use client';

import { useEffect, useState } from 'react';
import { showErrorToast } from './toast';

export interface ReportState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetch one section's report. Each section owns its state so a failure in one
 * never blanks the others. `key` identifies the request: a change refetches
 * and drops the old result, and a null key (an invalid input, or signed out)
 * skips the fetch and keeps whatever is on screen.
 */
export function useReport<T>(
  title: string,
  key: string | null,
  load: () => Promise<T>,
  fallbackError: string,
): ReportState<T> {
  const [state, setState] = useState<ReportState<T> & { key: string | null }>({
    key: null,
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : fallbackError;
        // The toast names the section because it shows away from it. The
        // inline message sits inside the section and needs no prefix.
        showErrorToast(`${title}: ${message}`);
        setState({ key, data: null, error: message, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // `load` closes over the values that make up `key`, so `key` alone
    // decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The stored result belongs to state.key. Until the effect for a new key
  // settles, that result is stale: report loading rather than render the old
  // range's chart or error for a frame. A null key fetches nothing and keeps
  // what is on screen.
  if (key !== null && state.key !== key) {
    return { data: null, error: null, loading: true };
  }
  return { data: state.data, error: state.error, loading: state.loading };
}
