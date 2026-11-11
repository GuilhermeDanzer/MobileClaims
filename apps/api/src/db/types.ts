import type { Pool, PoolClient } from 'pg';

/** Anything that can run a query: a pooled connection or a transaction client. */
export type Db = Pool | PoolClient;
