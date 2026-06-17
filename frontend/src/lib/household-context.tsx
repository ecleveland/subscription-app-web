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
import { useAuth } from './auth-context';
import { getMyHousehold } from './households';
import type { Household, HouseholdMember } from './types';

interface HouseholdContextType {
  household: Household | null;
  members: HouseholdMember[];
  /** The membership row for the logged-in user (used to derive their role). */
  currentMember: HouseholdMember | null;
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextType | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setHousehold(null);
      setMembers([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getMyHousehold();
      setHousehold(data.household);
      setMembers(data.members);
    } catch (err) {
      // Surface the error but keep any last-known household so a transient
      // failure on a background refresh doesn't blank the UI to "no household".
      // The unauthenticated branch above is the only path that clears state.
      setError(err instanceof Error ? err.message : 'Failed to load household');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentMember = useMemo(
    () => members.find((m) => m.userId?._id === user?.userId) ?? null,
    [members, user],
  );

  const value = useMemo(
    () => ({
      household,
      members,
      currentMember,
      isOwner: currentMember?.role === 'owner',
      loading,
      error,
      refresh,
    }),
    [household, members, currentMember, loading, error, refresh],
  );

  return (
    <HouseholdContext.Provider value={value}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const context = useContext(HouseholdContext);
  if (!context) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return context;
}
