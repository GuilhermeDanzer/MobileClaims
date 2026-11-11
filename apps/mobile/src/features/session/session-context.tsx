import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { customerScope } from '@/db/ownership';
import { queryClient } from '@/lib/query-client';
import { setUnauthorizedHandler } from '@/lib/api-client';
import { getStoredToken, signInDev, signOut } from '@/lib/session';

/**
 * Customer session state. The token lives in SecureStore; this context just mirrors its
 * presence into the component tree and exposes sign-in/out. A 401 from any request flips
 * the state back to signed-out via the handler registered below.
 */

type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: SessionStatus;
  token: string | null;
  customerId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStoredToken().then((stored) => {
      if (cancelled) return;
      setToken(stored);
      setStatus(stored && customerScope(stored) ? 'signedIn' : 'signedOut');
    }).catch(() => {
      if (!cancelled) { setToken(null); setStatus('signedOut'); }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((requestToken) => {
      // A late 401 from a previous session must not sign out the next customer.
      if (!requestToken || requestToken !== token) return;
      setToken(null);
      setStatus('signedOut');
      queryClient.clear();
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [token]);

  const signIn = useCallback(async () => {
    await signInDev();
    const stored = await getStoredToken();
    setToken(stored);
    setStatus(stored && customerScope(stored) ? 'signedIn' : 'signedOut');
  }, []);

  const doSignOut = useCallback(async () => {
    setToken(null);
    setStatus('signedOut');
    queryClient.clear();
    await signOut();
    setStatus('signedOut');
  }, []);

  const value = useMemo(() => ({ status, token, customerId: customerScope(token), signIn, signOut: doSignOut }), [status, token, signIn, doSignOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider');
  return value;
}
