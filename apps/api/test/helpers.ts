import type { S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { loadConfig } from '../src/config';
import * as claimsRepo from '../src/db/claims-repo';
import { migrate } from '../src/db/migrate';
import { createStorageClient } from '../src/platform/health';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations');
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://claims:claims@localhost:5432/claims';
const TEST_DB = 'claims_test';

/** Creates (if needed) and migrates a dedicated test database, returning a pool to it. */
export async function setupTestDb(): Promise<Pool> {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if ((exists.rowCount ?? 0) === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  }
  await admin.end();

  const pool = new Pool({ connectionString: ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`) });
  await migrate(pool, MIGRATIONS_DIR);
  return pool;
}

export async function truncate(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE claims, claim_documents, claim_status_events, outbox_events, queue_messages,
     queue_dead_letters, notifications, idempotency, customers, policies RESTART IDENTITY CASCADE`,
  );
}

export async function insertCustomer(pool: Pool, withPolicy = false): Promise<string> {
  const customerId = randomUUID();
  await pool.query(`INSERT INTO customers (customer_id, email, display_name) VALUES ($1, $2, $3)`, [
    customerId,
    `${customerId}@example.com`,
    'Test Customer',
  ]);
  if (withPolicy) await pool.query(
    `INSERT INTO policies (customer_id, policy_number, product, active) VALUES ($1, 'POL-HOME-0001', 'Homeowners', true)`,
    [customerId],
  );
  return customerId;
}

export function createTestStorageClient(): S3Client {
  return createStorageClient(loadConfig());
}

export async function insertClaimRow(
  pool: Pool,
  customerId: string,
  overrides: { policyNumber?: string } = {},
): Promise<{ claimId: string; reference: string }> {
  const reference = `NW-2026-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
  const claim = await claimsRepo.insertClaim(pool, {
    customerId,
    clientClaimId: randomUUID(),
    reference,
    policyNumber: overrides.policyNumber ?? 'POL-HOME-0001',
    incidentDescription: 'Test incident',
    incidentDate: '2026-11-03',
  });
  return { claimId: claim!.claim_id, reference };
}

/** Creates a claim and marks it delivered to legacy, so it is eligible for reconciliation. */
export async function insertDeliveredClaim(
  pool: Pool,
  customerId: string,
): Promise<{ claimId: string; reference: string }> {
  const { claimId, reference } = await insertClaimRow(pool, customerId);
  await claimsRepo.markLegacyAccepted(pool, claimId);
  return { claimId, reference };
}

export interface ReconcileState {
  intake_status: string;
  legacy_status: string | null;
  reconcile_at: Date | null;
  reconcile_attempts: number;
}

export async function getReconcileState(pool: Pool, claimId: string): Promise<ReconcileState> {
  const result = await pool.query<ReconcileState>(
    `SELECT intake_status, legacy_status, reconcile_at, reconcile_attempts FROM claims WHERE claim_id = $1`,
    [claimId],
  );
  return result.rows[0]!;
}
