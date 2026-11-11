/**
 * A minimal, deliberate slice of the SQLite API that the repository layer needs.
 *
 * Two implementations exist:
 * - `adapters/expo-sqlite-adapter.ts` — the real app (expo-sqlite);
 * - `apps/mobile/test-db/node-sqlite-adapter.ts` — tests (node:sqlite).
 *
 * Keeping this interface narrow means the exact same SQL and transaction logic that runs on
 * the device also runs against a real SQLite engine in tests.
 */
export type SqlParam = string | number | null;

export interface SqliteAdapter {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T>;
}
