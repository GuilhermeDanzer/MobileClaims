import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';

import { listStatusEvents } from '../src/db/claims-repo';
import { LegacyGatewayError } from '../src/integrations/legacy/http-gateway';
import { SimulatedLegacyClaimsGateway } from '../src/integrations/legacy/simulated-gateway';
import { CircuitBreaker } from '../src/platform/circuit-breaker';
import { reconcileDueClaims, type ReconcileOptions } from '../src/worker/reconcile';
import { getReconcileState, insertClaimRow, insertCustomer, insertDeliveredClaim, setupTestDb, truncate } from './helpers';

let pool: Pool;
let customerId: string;

/** For sequential tests: poll again immediately (no lease, no interval). */
const FAST: ReconcileOptions = { pollIntervalSeconds: 0, leaseSeconds: 0 };

function makeBreaker(): CircuitBreaker {
  return new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
}

/** A mutable gateway whose getStatus reads a map and can be toggled to throw. */
function makeGateway() {
  const statuses = new Map<string, string>();
  let failure: (() => Error) | null = null;
  const gateway = new SimulatedLegacyClaimsGateway({
    getStatus: async (reference) => {
      if (failure) throw failure();
      return {
        reference,
        status: statuses.get(reference) ?? 'under_review',
        updatedAt: new Date().toISOString(),
      };
    },
  });
  return {
    gateway,
    set: (reference: string, status: string) => statuses.set(reference, status),
    fail: (fn: () => Error) => {
      failure = fn;
    },
    recover: () => {
      failure = null;
    },
  };
}

function statuses(events: { status: string }[]): string[] {
  return events.map((e) => e.status);
}

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

test('reconciles a delivered claim from legacy_accepted to under_review', async () => {
  const { gateway } = makeGateway();
  const { claimId } = await insertDeliveredClaim(pool, customerId);

  const count = await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);

  assert.equal(count, 1);
  assert.deepEqual(statuses(await listStatusEvents(pool, claimId)), ['under_review']);
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.legacy_status, 'under_review');
});

test('reconciles under_review to approved', async () => {
  const { gateway, set } = makeGateway();
  const { claimId, reference } = await insertDeliveredClaim(pool, customerId);

  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST); // under_review
  set(reference, 'approved');
  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST); // approved

  assert.deepEqual(statuses(await listStatusEvents(pool, claimId)), ['under_review', 'approved']);
});

test('reconciles to denied (terminal) and parks the claim', async () => {
  const { gateway, set } = makeGateway();
  const { claimId, reference } = await insertDeliveredClaim(pool, customerId);
  set(reference, 'denied');

  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);

  assert.deepEqual(statuses(await listStatusEvents(pool, claimId)), ['denied']);
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.reconcile_at, null); // parked: no further polling
  assert.equal(state.legacy_status, 'denied'); // terminal status is recorded

  const again = await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);
  assert.equal(again, 0);
});

test('repeated polling of the same status does not duplicate timeline events', async () => {
  const { gateway } = makeGateway();
  const { claimId } = await insertDeliveredClaim(pool, customerId);

  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);
  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);

  const events = await listStatusEvents(pool, claimId);
  assert.equal(statuses(events).filter((s) => s === 'under_review').length, 1);
});

test('a legacy timeout never invalidates an accepted claim and backs off', async () => {
  const { gateway, fail } = makeGateway();
  const { claimId } = await insertDeliveredClaim(pool, customerId);
  fail(() => new Error('ETIMEDOUT'));

  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);

  const events = await listStatusEvents(pool, claimId);
  assert.equal(events.length, 0); // no status change persisted
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.intake_status, 'legacy_accepted'); // not invalidated
  assert.equal(state.reconcile_attempts, 1);
});

test('legacy unavailability opens the breaker and leaves the claim intact', async () => {
  const { gateway, fail } = makeGateway();
  const { claimId } = await insertDeliveredClaim(pool, customerId);
  fail(() => new LegacyGatewayError('down', 503));
  const breaker = makeBreaker();

  for (let i = 0; i < 3; i += 1) {
    await reconcileDueClaims(pool, gateway, breaker, FAST);
  }

  assert.equal(breaker.currentState, 'open');
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.intake_status, 'legacy_accepted');
});

test('recovers after a temporary failure', async () => {
  const { gateway, fail, recover, set } = makeGateway();
  const { claimId, reference } = await insertDeliveredClaim(pool, customerId);
  set(reference, 'approved');
  fail(() => new Error('timeout'));
  const breaker = makeBreaker();

  await reconcileDueClaims(pool, gateway, breaker, FAST); // fails
  recover();
  await reconcileDueClaims(pool, gateway, breaker, FAST); // succeeds

  assert.deepEqual(statuses(await listStatusEvents(pool, claimId)), ['approved']);
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.legacy_status, 'approved');
  assert.equal(state.reconcile_attempts, 0);
});

test('concurrent reconciliation processes a claim exactly once', async () => {
  const { gateway } = makeGateway();
  const { claimId } = await insertDeliveredClaim(pool, customerId);

  // Default lease keeps the second concurrent pass from seeing the just-claimed claim.
  const [a, b] = await Promise.all([
    reconcileDueClaims(pool, gateway, makeBreaker()),
    reconcileDueClaims(pool, gateway, makeBreaker()),
  ]);

  assert.equal(a + b, 1);
  const events = await listStatusEvents(pool, claimId);
  assert.equal(statuses(events).filter((s) => s === 'under_review').length, 1);
});

test('survives worker restart without duplicating events', async () => {
  const { gateway } = makeGateway();
  const { claimId } = await insertDeliveredClaim(pool, customerId);

  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST); // "first" worker
  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST); // "restarted" worker

  const events = await listStatusEvents(pool, claimId);
  assert.equal(statuses(events).filter((s) => s === 'under_review').length, 1);
});

test('ignores claims that were never delivered to legacy', async () => {
  const { gateway } = makeGateway();
  const { claimId } = await insertClaimRow(pool, customerId); // intake_status = 'received'

  const count = await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);

  assert.equal(count, 0);
  assert.equal((await listStatusEvents(pool, claimId)).length, 0);
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.intake_status, 'received');
  assert.equal(state.reconcile_at, null);
});


test('expired in-flight poll cannot overwrite a newer terminal result or append a stale event', async () => {
  const { claimId, reference } = await insertDeliveredClaim(pool, customerId);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const slow = new SimulatedLegacyClaimsGateway({ getStatus: async () => {
    started(); await waiting;
    return { reference, status: 'approved', updatedAt: new Date().toISOString() };
  } });
  const first = reconcileDueClaims(pool, slow, makeBreaker(), FAST);
  await ready;
  const { gateway, set } = makeGateway();
  set(reference, 'denied');
  await reconcileDueClaims(pool, gateway, makeBreaker(), FAST);
  release();
  await first;
  const state = await getReconcileState(pool, claimId);
  assert.equal(state.legacy_status, 'denied');
  assert.equal(state.reconcile_at, null);
  assert.deepEqual(statuses(await listStatusEvents(pool, claimId)), ['denied']);
});
