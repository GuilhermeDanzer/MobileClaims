import { Pool } from 'pg';

/**
 * A single shared connection pool. The pool is lazy (it only connects on first query),
 * so the API boots even when Postgres is down; /health reports that state.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
}
