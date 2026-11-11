import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { openDatabaseAsync } from 'expo-sqlite';
import { createExpoSqliteAdapter } from './adapters/expo-sqlite-adapter';
import { initDatabase } from './schema';
import type { SqliteAdapter } from './sqlite-adapter';
import { databaseName } from './ownership';

const databases = new Map<string, Promise<SqliteAdapter>>();

/** Never open the historical unscoped database: its ownership is unknown. */
export async function getDatabase(owner: string | null): Promise<SqliteAdapter> {
  if (!owner) throw new Error('Sign in to access saved claims');
  let pending = databases.get(owner);
  if (!pending) {
    pending = (async () => {
      const name = await databaseName(owner, (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value));
      const adapter = createExpoSqliteAdapter(await openDatabaseAsync(name));
      await initDatabase(adapter);
      return adapter;
    })();
    databases.set(owner, pending);
    void pending.catch(() => databases.delete(owner));
  }
  return pending;
}
