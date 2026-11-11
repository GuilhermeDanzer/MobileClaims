import { useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { completeDocument, fetchClaim, fetchDocumentUploadUrl, submitClaim } from '@/features/claims/api';
import { getDatabase } from '@/db/database';
import { useSession } from '@/features/session/session-context';
import { consumeDropNextUpload, isForcedOffline } from './dev-flags';
import { runSync } from './sync-engine';
import { uploadToPresignedUrl } from './upload';

/**
 * React glue around the pure sync engine: supplies the real API/upload/storage dependencies,
 * serializes runs (single-flight), and triggers a sync on mount, foreground, and network
 * recovery. Exposes progress for diagnostics.
 */

export interface SyncProgress {
  syncing: boolean;
  uploads: Record<string, { sent: number; total: number }>;
  error?: string | null;
}

interface SyncValue {
  syncNow: () => Promise<void>;
  syncing: boolean;
  uploads: Record<string, { sent: number; total: number }>;
  error?: string | null;
}

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { status, token, customerId } = useSession();
  const queryClient = useQueryClient();
  const [progressOwner, setProgressOwner] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [uploads, setUploads] = useState<SyncProgress['uploads']>({});
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const activeToken = useRef(token);
  useLayoutEffect(() => { activeToken.current = token; }, [token]);
  const signedIn = status === 'signedIn';

  const syncNow = useCallback(async () => {
    if (inFlight.current || !signedIn || !token) return;
    inFlight.current = true;
    setProgressOwner(customerId);
    setSyncing(true);
    setError(null);
    setUploads({});
    try {
      const assertSession = () => {
        if (activeToken.current !== token) throw Object.assign(new Error('Sign in again to resume'), { kind: 'auth' });
      };
      const db = await getDatabase(customerId);
      const changed = await runSync({
        db,
        getToken: async () => activeToken.current === token ? token : null,
        isSessionCurrent: () => activeToken.current === token,
        submitClaim: async (...args) => { assertSession(); return submitClaim(...args); },
        getClaim: async (...args) => { assertSession(); return fetchClaim(...args); },
        getUploadUrl: async (...args) => { assertSession(); return fetchDocumentUploadUrl(...args); },
        completeDocument: async (...args) => { assertSession(); return completeDocument(...args); },
        uploadFile: async (input, url, onProgress) => {
          assertSession();
          if (consumeDropNextUpload()) throw new Error('upload dropped (diagnostics)');
          await uploadToPresignedUrl(input, url, onProgress);
        },
        now: () => new Date().toISOString(),
        isOnline: () => !isForcedOffline(),
        onProgress: (draftId, attachmentId, sent, total) =>
          activeToken.current === token && setUploads((current) => ({ ...current, [`${draftId}:${attachmentId}`]: { sent, total } })),
      });
      // Server state changed; refresh the dashboard and local submission list.
      if (activeToken.current !== token || !changed) return;
      void queryClient.invalidateQueries({ queryKey: ['claims', customerId] });
      void queryClient.invalidateQueries({ queryKey: ['submissions', 'local'] });
    } catch {
      if (activeToken.current === token) setError('Could not sync saved claims. Retrying while the app is open.');
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, [signedIn, token, customerId, queryClient]);

  // Sync on sign-in and whenever the app returns to the foreground.
  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => void syncNow(), 0);
    return () => clearTimeout(timer);
  }, [signedIn, syncNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);

  // Honor persisted backoff even if connectivity and foreground state never change.
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void syncNow();
    }, 5_000);
    return () => clearInterval(timer);
  }, [signedIn, syncNow]);

  // Sync when connectivity recovers.
  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online) {
        void queryClient.invalidateQueries({ queryKey: ['claims'] });
        void queryClient.invalidateQueries({ queryKey: ['policies'] });
        void syncNow();
      }
    });
    return () => subscription.remove();
  }, [syncNow, queryClient]);

  const value = useMemo(() => ({ syncNow, syncing: syncing && progressOwner === customerId, uploads: progressOwner === customerId ? uploads : {}, error: progressOwner === customerId ? error : null }), [syncNow, syncing, uploads, error, progressOwner, customerId]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used within a SyncProvider');
  return value;
}
