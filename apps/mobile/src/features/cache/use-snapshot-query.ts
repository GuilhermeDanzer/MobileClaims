import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db/database';
import { readSnapshot, writeSnapshot, type Snapshot } from '@/db/snapshots-repo';
import { useSession } from '@/features/session/session-context';
import { useIsOnline } from '@/features/sync/network';
import { isForcedOffline } from '@/features/sync/dev-flags';

type ReadResult<T> = Snapshot<T> & { cached: boolean };

/** One hydration path for all server reads. Hydration finishes before network fetching. */
export function useSnapshotQuery<T>(group: string, resource: string, fetcher: (token: string) => Promise<T>, ttl = 5_000, parse?: (value: unknown) => T) {
  const { customerId, token } = useSession();
  const client = useQueryClient();
  const online = useIsOnline();
  const previousOnline = useRef(online);
  const identity = JSON.stringify([group, customerId, resource]);
  const [hydrated, setHydrated] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!customerId) return;
    void (async () => {
      try {
        const db = await getDatabase(customerId);
        const snapshot = await readSnapshot<T>(db, `${group}:${resource}`);
        if (snapshot && parse) snapshot.data = parse(snapshot.data);
        if (!cancelled && snapshot && !client.getQueryData([group, customerId, resource])) {
          client.setQueryData<ReadResult<T>>([group, customerId, resource], (current) =>
            current ?? { ...snapshot, cached: true }, { updatedAt: snapshot.fetchedAt });
        }
      } catch {
        // A cache failure must not prevent an online read.
      } finally {
        if (!cancelled) setHydrated(identity);
      }
    })();
    return () => { cancelled = true; };
  }, [client, customerId, group, resource, identity, parse]);

  const query = useQuery({
    queryKey: [group, customerId, resource],
    queryFn: async (): Promise<ReadResult<T>> => {
      if (!token || !customerId) throw new Error('Sign in to view saved information');
      if (!online || isForcedOffline()) throw new Error('Offline — showing saved information when available');
      const fetchedAt = Date.now();
      const data = await fetcher(token);
      const result = { data, fetchedAt, cached: false };
      const db = await getDatabase(customerId);
      await writeSnapshot(db, `${group}:${resource}`, result);
      return result;
    },
    enabled: !!customerId && hydrated === identity,
    networkMode: 'always',
    retry: false,
    staleTime: ttl,
    refetchInterval: online ? Math.max(15_000, ttl) : false,
  });
  // A connectivity transition refreshes even a policy snapshot within its TTL.
  useEffect(() => {
    const reconnected = online && !previousOnline.current;
    previousOnline.current = online;
    if (reconnected && hydrated === identity && customerId) {
      void client.invalidateQueries({ queryKey: [group, customerId, resource] });
    }
  }, [online, hydrated, identity, customerId, client, group, resource]);

  return { ...query, data: query.data?.data, cachedAt: query.data?.fetchedAt,
    isCached: !!query.data && (query.data.cached || !online || query.isError),
    isLoading: hydrated !== identity || query.isLoading };
}
