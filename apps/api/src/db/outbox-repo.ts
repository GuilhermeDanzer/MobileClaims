import type { Db } from './types';

/** Transactional outbox (ADR-005): durable events published to the queue later. */

export interface OutboxEventRow {
  event_id: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
}

export async function insertOutboxEvent(
  db: Db,
  input: { aggregateId: string; eventType: string; payload: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO outbox_events (aggregate_id, event_type, payload) VALUES ($1, $2, $3)`,
    [input.aggregateId, input.eventType, JSON.stringify(input.payload)],
  );
}

export async function getUnpublishedOutboxEvents(db: Db, limit = 100): Promise<OutboxEventRow[]> {
  const result = await db.query<OutboxEventRow>(
    `SELECT event_id::text AS event_id, aggregate_id, event_type, payload
     FROM outbox_events WHERE published_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM claim_documents d WHERE d.claim_id = aggregate_id AND d.status <> 'complete') ORDER BY event_id LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function markOutboxPublished(db: Db, eventIds: string[]): Promise<void> {
  await db.query(
    `UPDATE outbox_events SET published_at = now() WHERE event_id = ANY($1::bigint[])`,
    [eventIds],
  );
}
