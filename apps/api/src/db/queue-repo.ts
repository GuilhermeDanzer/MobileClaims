import type { Db } from './types';

/**
 * Local message queue (Level B) reproducing SQS semantics — visibility timeout,
 * at-least-once delivery, retry with backoff, and a dead-letter queue (ADR-014).
 * It reproduces delivery semantics, not SQS throughput characteristics.
 */

export interface QueueMessageRow {
  message_id: string;
  queue: string;
  payload: unknown;
  attempt_count: number;
}

export interface DeadLetterRow {
  dead_letter_id: string;
  queue: string;
  payload: unknown;
  last_error: string;
  attempt_count: number;
  created_at: Date;
}

export async function enqueue(
  db: Db,
  input: { queue: string; payload: unknown; delaySeconds?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO queue_messages (queue, payload, visible_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [input.queue, JSON.stringify(input.payload), input.delaySeconds ?? 0],
  );
}

/**
 * Atomically locks the next visible message and increments its attempt count.
 * `FOR UPDATE SKIP LOCKED` lets multiple consumers share the queue safely.
 */
export async function claimMessage(
  pool: Db,
  queue: string,
  visibilitySeconds: number,
): Promise<QueueMessageRow | null> {
  const result = await pool.query<QueueMessageRow>(
    `WITH locked AS (
       SELECT message_id FROM queue_messages
       WHERE queue = $1 AND visible_at <= now() AND (locked_until IS NULL OR locked_until < now())
       ORDER BY message_id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE queue_messages q
     SET locked_until = now() + make_interval(secs => $2), attempt_count = attempt_count + 1
     FROM locked
     WHERE q.message_id = locked.message_id
     RETURNING q.message_id::text AS message_id, q.queue, q.payload, q.attempt_count`,
    [queue, visibilitySeconds],
  );
  return result.rows[0] ?? null;
}

export async function completeMessage(pool: Db, messageId: string, attempt?: number): Promise<void> {
  await pool.query(`DELETE FROM queue_messages WHERE message_id = $1 AND ($2::int IS NULL OR attempt_count = $2)`, [messageId, attempt ?? null]);
}

/**
 * Records a failed attempt. Below the attempt limit the message is made visible again
 * after a backoff; at the limit it is moved to the dead-letter queue.
 */
export async function failMessage(
  pool: Db,
  input: { messageId: string; lastError: string; maxAttempts: number; requeueDelaySeconds: number; attempt?: number },
): Promise<'retry' | 'dead'> {
  const dead = await pool.query(`WITH moved AS (
    DELETE FROM queue_messages WHERE message_id = $1 AND attempt_count >= $2
      AND ($3::int IS NULL OR attempt_count = $3)
    RETURNING queue, payload, attempt_count
  ) INSERT INTO queue_dead_letters (queue, payload, last_error, attempt_count)
    SELECT queue, payload, $4, attempt_count FROM moved RETURNING dead_letter_id`,
    [input.messageId, input.maxAttempts, input.attempt ?? null, input.lastError]);
  if (dead.rowCount) return 'dead';
  await pool.query(`UPDATE queue_messages SET locked_until = NULL,
    visible_at = now() + make_interval(secs => $2)
    WHERE message_id = $1 AND ($3::int IS NULL OR attempt_count = $3)`,
    [input.messageId, input.requeueDelaySeconds, input.attempt ?? null]);
  return 'retry';
}

export async function listDeadLetters(pool: Db, queue: string): Promise<DeadLetterRow[]> {
  const result = await pool.query<DeadLetterRow>(
    `SELECT dead_letter_id::text AS dead_letter_id, queue, payload, last_error, attempt_count, created_at
     FROM queue_dead_letters WHERE queue = $1 ORDER BY dead_letter_id DESC LIMIT 50`,
    [queue],
  );
  return result.rows;
}

/** Redrives dead-lettered messages back onto the queue with a fresh attempt count. */
export async function requeueDeadLetters(pool: Db, queue: string): Promise<number> {
  const result = await pool.query(
    `WITH moved AS (
       DELETE FROM queue_dead_letters WHERE queue = $1 RETURNING queue, payload
     )
     INSERT INTO queue_messages (queue, payload, visible_at, attempt_count)
     SELECT queue, payload, now(), 0 FROM moved
     RETURNING message_id`,
    [queue],
  );
  return result.rowCount ?? 0;
}
