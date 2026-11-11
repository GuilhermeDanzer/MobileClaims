import type { SQLiteDatabase } from 'expo-sqlite';

import type { SqliteAdapter, SqlParam } from '../sqlite-adapter';

/** The expo-sqlite implementation of the repository's narrow SQLite surface. */
export function createExpoSqliteAdapter(db: SQLiteDatabase): SqliteAdapter {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params = []) => {
      const result = await db.runAsync(sql, params as never[]);
      return { lastInsertRowId: result.lastInsertRowId, changes: result.changes };
    },
    getAllAsync: async <T>(sql: string, params: SqlParam[] = []) =>
      (await db.getAllAsync<T>(sql, params as never[])) as T[],
    getFirstAsync: async <T>(sql: string, params: SqlParam[] = []) =>
      ((await db.getFirstAsync<T>(sql, params as never[])) as T | null) ?? null,
    // expo's withTransactionAsync only returns void, so capture the task's result out of band.
    withTransactionAsync: async <T>(fn: () => Promise<T>) => {
      let result: T;
      await db.withTransactionAsync(async () => {
        result = await fn();
      });
      return result!;
    },
  };
}
