import type { Db } from './types';

/** Plain-SQL access to the claim aggregate (claims, documents, status events). */

export interface ClaimRow {
  claim_id: string;
  customer_id: string;
  client_claim_id: string;
  reference: string;
  policy_number: string | null;
  intake_status: string;
  incident_description: string | null;
  incident_date: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentRow {
  document_id: string;
  claim_id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  scan_status: string;
}

export interface StatusEventRow {
  status: string;
  label: string;
  source: string;
  at: Date;
}

export async function insertClaim(
  db: Db,
  input: {
    customerId: string;
    clientClaimId: string;
    reference: string;
    policyNumber: string;
    incidentDescription: string;
    incidentDate: string;
  },
): Promise<ClaimRow | null> {
  const result = await db.query<ClaimRow>(
    `INSERT INTO claims (customer_id, client_claim_id, reference, policy_number, incident_description, incident_date, intake_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'received')
     ON CONFLICT (customer_id, client_claim_id) DO NOTHING
     RETURNING claim_id, customer_id, client_claim_id, reference, policy_number, intake_status,
               incident_description, incident_date, created_at, updated_at`,
    [input.customerId, input.clientClaimId, input.reference, input.policyNumber, input.incidentDescription, input.incidentDate],
  );
  return result.rows[0] ?? null;
}

export async function getClaimByClientId(
  db: Db,
  customerId: string,
  clientClaimId: string,
): Promise<ClaimRow | null> {
  const result = await db.query<ClaimRow>(
    `SELECT claim_id, customer_id, client_claim_id, reference, policy_number, intake_status,
            incident_description, incident_date, created_at, updated_at
     FROM claims WHERE customer_id = $1 AND client_claim_id = $2`,
    [customerId, clientClaimId],
  );
  return result.rows[0] ?? null;
}

export async function getClaimById(db: Db, customerId: string, claimId: string): Promise<ClaimRow | null> {
  const result = await db.query<ClaimRow>(
    `SELECT claim_id, customer_id, client_claim_id, reference, policy_number, intake_status,
            incident_description, incident_date, created_at, updated_at
     FROM claims WHERE customer_id = $1 AND claim_id = $2`,
    [customerId, claimId],
  );
  return result.rows[0] ?? null;
}

export interface ClaimListItemRow extends ClaimRow {
  latest_status: string | null;
}

export async function listClaims(db: Db, customerId: string): Promise<ClaimListItemRow[]> {
  const result = await db.query<ClaimListItemRow>(
    `SELECT c.claim_id, c.customer_id, c.client_claim_id, c.reference, c.policy_number, c.intake_status,
            c.incident_description, c.incident_date, c.created_at, c.updated_at,
            (SELECT e.status FROM claim_status_events e
              WHERE e.claim_id = c.claim_id ORDER BY e.at DESC, e.event_id DESC LIMIT 1) AS latest_status
     FROM claims c WHERE c.customer_id = $1 ORDER BY c.created_at DESC`,
    [customerId],
  );
  return result.rows;
}

export async function insertDocument(
  db: Db,
  input: {
    claimId: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  },
): Promise<DocumentRow> {
  const result = await db.query<DocumentRow>(
    `INSERT INTO claim_documents (claim_id, storage_key, file_name, content_type, size_bytes, sha256, status, scan_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending_upload', 'not_scanned')
     RETURNING document_id, claim_id, storage_key, file_name, content_type, size_bytes::int AS size_bytes, sha256, status, scan_status`,
    [input.claimId, input.storageKey, input.fileName, input.contentType, input.sizeBytes, input.sha256],
  );
  return result.rows[0]!;
}

export async function getDocument(db: Db, claimId: string, documentId: string): Promise<DocumentRow | null> {
  const result = await db.query<DocumentRow>(
    `SELECT document_id, claim_id, storage_key, file_name, content_type, size_bytes::int AS size_bytes, sha256, status, scan_status
     FROM claim_documents WHERE claim_id = $1 AND document_id = $2`,
    [claimId, documentId],
  );
  return result.rows[0] ?? null;
}

export async function listDocuments(db: Db, claimId: string): Promise<DocumentRow[]> {
  const result = await db.query<DocumentRow>(
    `SELECT document_id, claim_id, storage_key, file_name, content_type, size_bytes::int AS size_bytes, sha256, status, scan_status
     FROM claim_documents WHERE claim_id = $1 ORDER BY document_id`,
    [claimId],
  );
  return result.rows;
}

export async function markDocumentComplete(db: Db, claimId: string, documentId: string): Promise<void> {
  await db.query(
    `UPDATE claim_documents SET status = 'complete' WHERE claim_id = $1 AND document_id = $2`,
    [claimId, documentId],
  );
}

export async function insertStatusEvent(
  db: Db,
  input: { claimId: string; status: string; label: string; source: 'platform' | 'legacy' },
): Promise<void> {
  await db.query(
    `INSERT INTO claim_status_events (claim_id, status, label, source) VALUES ($1, $2, $3, $4)`,
    [input.claimId, input.status, input.label, input.source],
  );
}

export async function listStatusEvents(db: Db, claimId: string): Promise<StatusEventRow[]> {
  const result = await db.query<StatusEventRow>(
    `SELECT status, label, source, at FROM claim_status_events WHERE claim_id = $1 ORDER BY at ASC, event_id ASC`,
    [claimId],
  );
  return result.rows;
}

export async function getLatestStatus(db: Db, claimId: string): Promise<string | null> {
  const result = await db.query<{ status: string }>(
    `SELECT status FROM claim_status_events WHERE claim_id = $1 ORDER BY at DESC, event_id DESC LIMIT 1`,
    [claimId],
  );
  return result.rows[0]?.status ?? null;
}

// --- Reconciliation (ADR-016) -----------------------------------------------------------

export interface DueClaimRow {
  claim_id: string;
  customer_id: string;
  reference: string;
  legacy_status: string | null;
  reconcile_attempts: number;
  reconcile_generation: string;
}

/**
 * Atomically leases up to `limit` due claims by advancing their reconcile_at into the
 * future. `FOR UPDATE SKIP LOCKED` means concurrent workers never claim the same claim.
 * The lease is released implicitly when reconcile_at passes again (crash-safe).
 */
export async function claimDueClaims(db: Db, limit: number, leaseSeconds: number): Promise<DueClaimRow[]> {
  const result = await db.query<DueClaimRow>(
    `WITH due AS (
       SELECT claim_id FROM claims
       WHERE intake_status = 'legacy_accepted' AND reconcile_at IS NOT NULL AND reconcile_at <= now()
       ORDER BY reconcile_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE claims c
     SET reconcile_at = now() + make_interval(secs => $2), reconcile_generation = reconcile_generation + 1
     FROM due
     WHERE c.claim_id = due.claim_id
     RETURNING c.claim_id, c.customer_id, c.reference, c.legacy_status, c.reconcile_attempts, c.reconcile_generation::text`,
    [limit, leaseSeconds],
  );
  return result.rows;
}

/** Records a successful poll: persists the status and schedules the next poll. */
export async function recordLegacyStatus(db: Db, claimId: string, status: string, nextPollAt: Date): Promise<void> {
  await db.query(
    `UPDATE claims SET legacy_status = $2, reconcile_attempts = 0, reconcile_at = $3, updated_at = now()
     WHERE claim_id = $1`,
    [claimId, status, nextPollAt],
  );
}

/** Records a failed poll: increments the attempt count and backs off the next poll. */
export async function recordReconcileFailure(db: Db, claimId: string, attempts: number, nextPollAt: Date): Promise<void> {
  await db.query(
    `UPDATE claims SET reconcile_attempts = $2, reconcile_at = $3, updated_at = now() WHERE claim_id = $1`,
    [claimId, attempts, nextPollAt],
  );
}

/** Parks a claim (terminal downstream status) and records that final status. */
export async function parkClaim(db: Db, claimId: string, legacyStatus: string): Promise<void> {
  await db.query(
    `UPDATE claims SET legacy_status = $2, reconcile_at = NULL, updated_at = now() WHERE claim_id = $1`,
    [claimId, legacyStatus],
  );
}

/** Marks a claim as delivered to legacy and eligible for reconciliation. */
export async function markLegacyAccepted(db: Db, claimId: string, legacyClaimNumber?: string): Promise<void> {
  await db.query(
    `UPDATE claims SET legacy_claim_number = COALESCE($2, legacy_claim_number), intake_status = 'legacy_accepted', reconcile_at = now(), reconcile_attempts = 0, updated_at = now()
     WHERE claim_id = $1`,
    [claimId, legacyClaimNumber ?? null],
  );
}

/** Marks a claim as permanently rejected by legacy (no reconciliation). */
export async function markLegacyRejected(db: Db, claimId: string): Promise<void> {
  await db.query(
    `UPDATE claims SET intake_status = 'legacy_rejected', reconcile_at = NULL, updated_at = now() WHERE claim_id = $1`,
    [claimId],
  );
}
