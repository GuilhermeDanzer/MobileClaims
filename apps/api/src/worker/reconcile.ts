import type { Pool } from 'pg';

import * as claimsRepo from '../db/claims-repo';
import type { DueClaimRow } from '../db/claims-repo';
import type { LegacyClaimsGateway } from '../integrations/legacy/types';
import { CircuitOpenError, type CircuitBreaker } from '../platform/circuit-breaker';
import { increment } from '../platform/metrics';

/**
 * Status reconciliation (ADR-016). Periodically polls the legacy claims system for the
 * downstream adjudication status of claims that have been delivered, and mirrors changes
 * into the claim timeline.
 *
 * Documented assumptions:
 * - The legacy system is polled by platform claim reference (getStatus(reference)).
 * - Downstream statuses use the `legacyStatuses` vocabulary in @northwind/contracts.
 * - "Rejected" in the business sense is the legacy `denied` status (there is no `rejected`).
 * - `denied` and `closed` are terminal: once reached, the claim is no longer polled.
 * - A poll failure (timeout/unavailable) never mutates the claim; it only backs off the
 *   next poll, so an already-accepted claim is never invalidated.
 */
const LEGACY_STATUS_LABELS: Record<string, string> = {
  under_review: 'Under review',
  info_requested: 'Additional information requested',
  adjuster_assigned: 'Adjuster assigned',
  approved: 'Claim approved',
  denied: 'Claim denied',
  payment_issued: 'Payment issued',
  closed: 'Claim closed',
};

const TERMINAL_LEGACY_STATUSES = new Set(['denied', 'closed']);

export interface ReconcileOptions {
  pollIntervalSeconds?: number;
  maxBackoffSeconds?: number;
  leaseSeconds?: number;
  batchSize?: number;
}

const DEFAULTS = {
  pollIntervalSeconds: 15,
  maxBackoffSeconds: 300,
  leaseSeconds: 30,
  batchSize: 25,
} as const;

/**
 * One reconciliation pass. Leases a batch of due claims (atomically, so concurrent workers
 * never process the same claim), polls each, and persists any status change. Returns the
 * number of claims polled.
 */
export async function reconcileDueClaims(
  pool: Pool,
  gateway: LegacyClaimsGateway,
  breaker: CircuitBreaker,
  options: ReconcileOptions = {},
): Promise<number> {
  const pollInterval = options.pollIntervalSeconds ?? DEFAULTS.pollIntervalSeconds;
  const maxBackoff = options.maxBackoffSeconds ?? DEFAULTS.maxBackoffSeconds;
  const lease = options.leaseSeconds ?? DEFAULTS.leaseSeconds;
  const batch = options.batchSize ?? DEFAULTS.batchSize;

  // Skip the whole pass while the breaker is open (legacy known down).
  if (!breaker.allowProbe()) return 0;

  const due = await claimsRepo.claimDueClaims(pool, batch, lease);
  for (const claim of due) {
    await reconcileOne(pool, gateway, breaker, claim, { pollInterval, maxBackoff, lease });
  }
  return due.length;
}

async function reconcileOne(
  pool: Pool,
  gateway: LegacyClaimsGateway,
  breaker: CircuitBreaker,
  claim: DueClaimRow,
  opts: { pollInterval: number; maxBackoff: number; lease: number },
): Promise<void> {
  try {
    const current = await breaker.run(() => gateway.getStatus(claim.reference));

    await persistPoll(pool, claim, current.status, secondsFromNow(opts.pollInterval));
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      // Breaker already open: re-lease without counting a failure; the breaker gates retries.
      await persistFailure(pool, claim, claim.reconcile_attempts, secondsFromNow(opts.pollInterval));
      return;
    }
    // Transient failure (timeout / 5xx / network): back off and keep the claim intact.
    const attempts = claim.reconcile_attempts + 1;
    const backoff = Math.min(opts.pollInterval * 2 ** attempts, opts.maxBackoff);
    await persistFailure(pool, claim, attempts, secondsFromNow(backoff));
    increment('reconciliation.failed');
  }
}

/** Generation fences expired leases; status and timeline commit together. */
async function persistPoll(pool: Pool, claim: DueClaimRow, status: string, next: Date): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ legacy_status: string | null }>(
      `SELECT legacy_status FROM claims WHERE claim_id = $1 AND reconcile_generation = $2
       AND reconcile_at IS NOT NULL AND intake_status = 'legacy_accepted' FOR UPDATE`,
      [claim.claim_id, claim.reconcile_generation]);
    const row = result.rows[0];
    if (row && !TERMINAL_LEGACY_STATUSES.has(row.legacy_status ?? '')) {
      if (row.legacy_status !== status) {
        await claimsRepo.insertStatusEvent(client, { claimId: claim.claim_id, status,
          label: LEGACY_STATUS_LABELS[status] ?? 'Status updated', source: 'legacy' });
        increment('reconciliation.changed');
      }
      if (TERMINAL_LEGACY_STATUSES.has(status)) {
        await claimsRepo.parkClaim(client, claim.claim_id, status);
        increment('reconciliation.terminal');
      } else {
        await claimsRepo.recordLegacyStatus(client, claim.claim_id, status, next);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function persistFailure(pool: Pool, claim: DueClaimRow, attempts: number, next: Date): Promise<void> {
  await pool.query(`UPDATE claims SET reconcile_attempts = $3, reconcile_at = $4
    WHERE claim_id = $1 AND reconcile_generation = $2 AND reconcile_at IS NOT NULL
    AND (legacy_status IS NULL OR legacy_status NOT IN ('denied', 'closed'))`,
    [claim.claim_id, claim.reconcile_generation, attempts, next]);
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
