import type { SqliteAdapter } from './sqlite-adapter';

export interface Snapshot<T> { data: T; fetchedAt: number }
export const POLICY_TTL_MS = 15 * 60 * 1000;
export function snapshotExpired(fetchedAt: number, now = Date.now(), ttl = POLICY_TTL_MS): boolean {
  return now - fetchedAt >= ttl;
}

export async function readSnapshot<T>(db: SqliteAdapter, resource: string): Promise<Snapshot<T> | null> {
  const row = await db.getFirstAsync<{ payload: string; fetched_at: number }>(
    'SELECT payload, fetched_at FROM read_snapshots WHERE resource = ?', [resource]);
  if (!row) return null;
  try { return { data: JSON.parse(row.payload) as T, fetchedAt: row.fetched_at }; }
  catch { return null; }
}

/** Request start time prevents a slow, older response overwriting a later refresh. */
export async function writeSnapshot<T>(db: SqliteAdapter, resource: string, snapshot: Snapshot<T>): Promise<void> {
  await db.runAsync(`INSERT INTO read_snapshots (resource, payload, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT(resource) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
    WHERE excluded.fetched_at > read_snapshots.fetched_at`,
    [resource, JSON.stringify(snapshot.data), snapshot.fetchedAt]);
}
