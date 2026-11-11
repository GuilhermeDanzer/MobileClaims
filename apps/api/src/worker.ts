import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config';
import * as flagsRepo from './db/flags-repo';
import { migrate } from './db/migrate';
import * as outboxRepo from './db/outbox-repo';
import { createPool } from './db/pool';
import * as queueRepo from './db/queue-repo';
import { HttpLegacyClaimsGateway } from './integrations/legacy/http-gateway';
import { createLogger } from './logger';
import { CircuitBreaker } from './platform/circuit-breaker';
import { increment, setGauge } from './platform/metrics';
import { deliverClaim, type DeliverPayload } from './worker/deliver';
import { reconcileDueClaims } from './worker/reconcile';

const QUEUE = 'claims';
const VISIBILITY_SECONDS = 30;
const REQUEUE_DELAY_SECONDS = 2;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'db', 'migrations');

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL);

  try {
    await migrate(pool, MIGRATIONS_DIR);
  } catch (error) {
    logger.warn({ err: error }, 'migration failed — will keep trying against a down database');
  }

  const gateway = new HttpLegacyClaimsGateway(config.LEGACY_BASE_URL);
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

  logger.info({ queue: QUEUE, legacy: config.LEGACY_BASE_URL }, 'worker started');

  // Drain the outbox into the queue, then consume. Runs until the process is terminated.
  let lastReconcileMs = 0;
  for (;;) {
    await publishOutbox(pool, logger);

    const paused = await flagsRepo.getFlag(pool, 'queuePaused', false);

    // Periodically reconcile delivered claims' status with the legacy system (ADR-016).
    if (!paused && Date.now() - lastReconcileMs >= 1_000) {
      lastReconcileMs = Date.now();
      try {
        await reconcileDueClaims(pool, gateway, breaker);
      } catch (error) {
        logger.warn({ err: error }, 'reconciliation pass failed');
      }
    }

    // Pause consumption while the breaker is open rather than burning retry attempts
    // against a known-down legacy system. allowProbe() re-opens after the reset window.
    if (paused || !breaker.allowProbe()) {
      await flagsRepo.setFlag(pool, 'worker.breakerState', breaker.currentState);
      await sleep(1_000);
      continue;
    }

    const message = await queueRepo.claimMessage(pool, QUEUE, VISIBILITY_SECONDS);
    if (!message) {
      setGauge('queue.depth', await queueDepth(pool));
      await sleep(200);
      continue;
    }

    setGauge('queue.depth', await queueDepth(pool));
    await flagsRepo.setFlag(pool, 'worker.breakerState', breaker.currentState);

    try {
      await deliverClaim(pool, gateway, breaker, message.payload as DeliverPayload);
      await queueRepo.completeMessage(pool, message.message_id, message.attempt_count);
      increment('messages.completed');
    } catch (error) {
      const outcome = await queueRepo.failMessage(pool, {
        messageId: message.message_id,
        attempt: message.attempt_count,
        lastError: error instanceof Error ? error.message : String(error),
        maxAttempts: config.QUEUE_MAX_ATTEMPTS,
        requeueDelaySeconds: Math.min(300, REQUEUE_DELAY_SECONDS * 2 ** Math.min(message.attempt_count - 1, 8)),
      });
      increment(outcome === 'dead' ? 'queue.dead_lettered' : 'queue.retried');
      logger.warn({ err: error, outcome, messageId: message.message_id }, 'message failed');
    }
  }
}

async function publishOutbox(
  pool: ReturnType<typeof createPool>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const events = await outboxRepo.getUnpublishedOutboxEvents(pool, 100);
  if (events.length === 0) return;
  for (const event of events) {
    await queueRepo.enqueue(pool, { queue: QUEUE, payload: event.payload });
  }
  await outboxRepo.markOutboxPublished(pool, events.map((e) => e.event_id));
  logger.info({ count: events.length }, 'outbox events published to queue');
}

async function queueDepth(pool: ReturnType<typeof createPool>): Promise<number> {
  const result = await pool.query<{ c: number }>('SELECT count(*)::int AS c FROM queue_messages');
  return result.rows[0]!.c;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
