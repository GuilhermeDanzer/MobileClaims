import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';

import { claimMessage, completeMessage, enqueue, failMessage, listDeadLetters } from '../src/db/queue-repo';
import { setupTestDb, truncate } from './helpers';

let pool: Pool;

before(async () => {
  pool = await setupTestDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool);
});

test('claims the next visible message and removes it on completion', async () => {
  await enqueue(pool, { queue: 'claims', payload: { a: 1 } });

  const message = await claimMessage(pool, 'claims', 30);
  assert.ok(message);
  assert.equal(message.attempt_count, 1);

  await completeMessage(pool, message.message_id);
  const next = await claimMessage(pool, 'claims', 30);
  assert.equal(next, null);
});

test('a message that keeps failing is moved to the dead-letter queue', async () => {
  await enqueue(pool, { queue: 'claims', payload: { a: 1 } });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const message = await claimMessage(pool, 'claims', 30);
    assert.ok(message, `attempt ${attempt} should find the message`);
    const outcome = await failMessage(pool, {
      messageId: message.message_id,
      lastError: 'legacy unreachable',
      maxAttempts: 3,
      requeueDelaySeconds: 0,
    });
    if (attempt < 3) assert.equal(outcome, 'retry');
    else assert.equal(outcome, 'dead');
  }

  const dead = await listDeadLetters(pool, 'claims');
  assert.equal(dead.length, 1);
  assert.equal(dead[0]!.last_error, 'legacy unreachable');
  assert.equal(dead[0]!.attempt_count, 3);
});

test('a message failing below the limit becomes visible again for retry', async () => {
  await enqueue(pool, { queue: 'claims', payload: { a: 1 } });

  const first = await claimMessage(pool, 'claims', 30);
  const outcome = await failMessage(pool, {
    messageId: first!.message_id,
    lastError: 'timeout',
    maxAttempts: 3,
    requeueDelaySeconds: 0,
  });
  assert.equal(outcome, 'retry');

  const second = await claimMessage(pool, 'claims', 30);
  assert.ok(second);
  assert.equal(second.attempt_count, 2);
});

test('stale attempts cannot acknowledge or fail a newly leased message', async () => {
  await enqueue(pool, { queue: 'claims', payload: { test: true } });
  const first = (await claimMessage(pool, 'claims', 30))!;
  await pool.query("UPDATE queue_messages SET locked_until = now() - interval '1 second'");
  const second = (await claimMessage(pool, 'claims', 30))!;
  await completeMessage(pool, first.message_id, first.attempt_count);
  await failMessage(pool, { messageId: first.message_id, attempt: first.attempt_count, maxAttempts: 1, requeueDelaySeconds: 0, lastError: 'stale' });
  assert.equal((await pool.query('SELECT * FROM queue_messages')).rowCount, 1);
  assert.equal((await listDeadLetters(pool, 'claims')).length, 0);
  await completeMessage(pool, second.message_id, second.attempt_count);
  assert.equal((await pool.query('SELECT * FROM queue_messages')).rowCount, 0);
});
