import type { Db } from './types';

/** Idempotency-Key support: replay a POST within the TTL and get the stored response. */

export interface IdempotencyRow {
  idempotency_key: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
}

export async function getIdempotency(db: Db, key: string, customerId: string): Promise<IdempotencyRow | null> {
  const result = await db.query<IdempotencyRow>(
    `SELECT idempotency_key, request_hash, response_status, response_body
     FROM idempotency WHERE idempotency_key = $1 AND customer_id = $2 AND expires_at > now()`,
    [key, customerId],
  );
  return result.rows[0] ?? null;
}

export async function setIdempotency(
  db: Db,
  input: {
    key: string;
    customerId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
    ttlHours?: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO idempotency (idempotency_key, customer_id, request_hash, response_status, response_body, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
     ON CONFLICT (customer_id, idempotency_key) DO UPDATE SET
       request_hash = EXCLUDED.request_hash, response_status = EXCLUDED.response_status,
       response_body = EXCLUDED.response_body, expires_at = EXCLUDED.expires_at`,
    [input.key, input.customerId, input.requestHash, input.responseStatus, JSON.stringify(input.responseBody), input.ttlHours ?? 24],
  );
}
