import { DatabaseSync } from 'node:sqlite';

import type { SqliteAdapter } from '../src/db/sqlite-adapter';

/**
 * Test-only implementation of the repository's SQLite surface backed by node:sqlite, so the
 * exact SQL and transaction logic that runs on the device runs against a real SQLite engine
 * in CI. (node:sqlite emits an ExperimentalWarning on Node 22 — harmless.)
 */
export function createNodeSqliteAdapter(db: DatabaseSync): SqliteAdapter {
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    getAllAsync: async <T>(sql: string, params = []) => db.prepare(sql).all(...params) as T[],
    getFirstAsync: async <T>(sql: string, params = []) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    withTransactionAsync: async <T>(fn: () => Promise<T>) => {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function newMemoryDb(): DatabaseSync {
  return new DatabaseSync(':memory:');
}
