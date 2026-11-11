import type { Db } from './types';

/** Runtime flags (Level B) — used for dev fault injection and worker state visibility. */

export async function getFlag<T>(db: Db, flag: string, defaultValue: T): Promise<T> {
  const result = await db.query<{ value: unknown }>(`SELECT value FROM runtime_flags WHERE flag = $1`, [flag]);
  return result.rows[0] ? (result.rows[0].value as T) : defaultValue;
}

export async function setFlag(db: Db, flag: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO runtime_flags (flag, value) VALUES ($1, $2)
     ON CONFLICT (flag) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [flag, JSON.stringify(value)],
  );
}

export async function listFlags(db: Db): Promise<{ flag: string; value: unknown }[]> {
  const result = await db.query<{ flag: string; value: unknown }>(
    `SELECT flag, value FROM runtime_flags ORDER BY flag`,
  );
  return result.rows;
}
