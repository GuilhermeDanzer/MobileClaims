import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';

import { listNotifications } from '../src/db/notifications-repo';
import { listStatusEvents } from '../src/db/claims-repo';
import { LegacyGatewayError } from '../src/integrations/legacy/http-gateway';
import { SimulatedLegacyClaimsGateway } from '../src/integrations/legacy/simulated-gateway';
import { CircuitBreaker, CircuitOpenError } from '../src/platform/circuit-breaker';
import { deliverClaim } from '../src/worker/deliver';
import { insertClaimRow, insertCustomer, setupTestDb, truncate } from './helpers';

let pool: Pool;
let customerId: string;

before(async () => {
  pool = await setupTestDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool);
  customerId = await insertCustomer(pool);
});

function statuses(events: { status: string }[]): string[] {
  return events.map((e) => e.status);
}

test('delivers a claim and records legacy_accepted plus a notification', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  const gateway = new SimulatedLegacyClaimsGateway({
    createClaim: async () => ({ legacyClaimNumber: 'LEG-1', receivedAt: new Date().toISOString() }),
  });
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

  await deliverClaim(pool, gateway, breaker, { claimId, reference, customerId });

  const events = await listStatusEvents(pool, claimId);
  assert.ok(statuses(events).includes('legacy_accepted'));
  const notifications = await listNotifications(pool, customerId);
  assert.equal(notifications.length, 1);
});

test('a permanent 4xx rejection is recorded and does not throw', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  const gateway = new SimulatedLegacyClaimsGateway({
    createClaim: async () => {
      throw new LegacyGatewayError('rejected', 422);
    },
  });
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

  await deliverClaim(pool, gateway, breaker, { claimId, reference, customerId });

  const events = await listStatusEvents(pool, claimId);
  assert.ok(statuses(events).includes('legacy_rejected'));
});

test('a transient 5xx failure propagates so the caller retries', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  const gateway = new SimulatedLegacyClaimsGateway({
    createClaim: async () => {
      throw new LegacyGatewayError('boom', 500);
    },
  });
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

  await assert.rejects(() => deliverClaim(pool, gateway, breaker, { claimId, reference, customerId }));
});

test('after repeated failures the breaker opens and short-circuits without calling the gateway', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  let calls = 0;
  const gateway = new SimulatedLegacyClaimsGateway({
    createClaim: async () => {
      calls += 1;
      throw new LegacyGatewayError('down', 503);
    },
  });
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => deliverClaim(pool, gateway, breaker, { claimId, reference, customerId }));
  }
  assert.equal(breaker.currentState, 'open');
  assert.equal(calls, 3);

  await assert.rejects(
    () => deliverClaim(pool, gateway, breaker, { claimId, reference, customerId }),
    CircuitOpenError,
  );
  assert.equal(calls, 3); // the gateway was not called again
});

test('concurrent duplicate delivery and later redelivery preserve one outcome and legacy identifier', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  let calls = 0;
  const gateway = new SimulatedLegacyClaimsGateway({ createClaim: async () => {
    calls += 1;
    return { legacyClaimNumber: 'LEG-persisted', receivedAt: new Date().toISOString() };
  } });
  const payload = { claimId, reference, customerId };
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
  await Promise.all([deliverClaim(pool, gateway, breaker, payload), deliverClaim(pool, gateway, breaker, payload)]);
  await deliverClaim(pool, gateway, breaker, payload);
  assert.equal(calls, 1);
  assert.equal((await listNotifications(pool, customerId)).length, 1);
  assert.equal((await listStatusEvents(pool, claimId)).filter((e) => e.status === 'legacy_accepted').length, 1);
  assert.equal((await pool.query('SELECT legacy_claim_number FROM claims WHERE claim_id = $1', [claimId])).rows[0].legacy_claim_number, 'LEG-persisted');
});

test('pending evidence prevents legacy calls', async () => {
  const repo = await import('../src/db/claims-repo');
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  await repo.insertDocument(pool, { claimId, storageKey: 'private/pending', fileName: 'pending.jpg', contentType: 'image/jpeg', sizeBytes: 5, sha256: 'a'.repeat(64) });
  let calls = 0;
  const gateway = new SimulatedLegacyClaimsGateway({ createClaim: async () => { calls++; throw new Error('must not call'); } });
  await assert.rejects(deliverClaim(pool, gateway, new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 }), { claimId, reference, customerId }), /pending/);
  assert.equal(calls, 0);
});

test('ambiguous external success retries the stable reference; timeout and 429 do not reject claim', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  const seen = new Map<string, string>();
  let calls = 0;
  const gateway = new SimulatedLegacyClaimsGateway({ createClaim: async (input) => {
    calls++;
    seen.set(input.reference, seen.get(input.reference) ?? 'LEG-ambiguous');
    if (calls === 1) throw new Error('response lost after external commit');
    if (calls === 2) throw new LegacyGatewayError('throttled', 429);
    return { legacyClaimNumber: seen.get(input.reference)!, receivedAt: new Date().toISOString() };
  } });
  const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  const payload = { claimId, reference, customerId };
  await assert.rejects(deliverClaim(pool, gateway, breaker, payload));
  await assert.rejects(deliverClaim(pool, gateway, breaker, payload));
  await deliverClaim(pool, gateway, breaker, payload);
  assert.equal(seen.size, 1);
  assert.equal((await listNotifications(pool, customerId)).length, 1);
  assert.ok(!(await listStatusEvents(pool, claimId)).some((e) => e.status === 'legacy_rejected'));
});

test('local persistence failure rolls back the entire delivery outcome', async () => {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  await pool.query(`CREATE FUNCTION phase6_reject_notification() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected notification failure'; END $$`);
  await pool.query('CREATE TRIGGER phase6_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION phase6_reject_notification()');
  try {
    const gateway = new SimulatedLegacyClaimsGateway({ createClaim: async () => ({ legacyClaimNumber: 'LEG-rollback', receivedAt: new Date().toISOString() }) });
    await assert.rejects(deliverClaim(pool, gateway, new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 }), { claimId, reference, customerId }), /injected/);
    assert.equal((await listStatusEvents(pool, claimId)).length, 0);
    assert.equal((await listNotifications(pool, customerId)).length, 0);
    const row = (await pool.query('SELECT intake_status, legacy_claim_number FROM claims WHERE claim_id = $1', [claimId])).rows[0];
    assert.equal(row.intake_status, 'received');
    assert.equal(row.legacy_claim_number, null);
  } finally {
    await pool.query('DROP TRIGGER phase6_notification ON notifications');
    await pool.query('DROP FUNCTION phase6_reject_notification()');
  }
});
