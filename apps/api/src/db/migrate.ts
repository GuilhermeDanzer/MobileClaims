import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool } from 'pg';

/**
 * Minimal migration runner. SQL files in the migrations directory are applied in
 * filename order, each in its own transaction, and recorded in schema_migrations.
 * Migrations are additive only (ADR-010).
 */
export async function migrate(pool: Pool, migrationsDir: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('claims-schema-migrations', 0))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if ((already.rowCount ?? 0) > 0) continue;

      const sql = await readFile(join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return applied;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended('claims-schema-migrations', 0))"); } finally { client.release(); }
  }
}
