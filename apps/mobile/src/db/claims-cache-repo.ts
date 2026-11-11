import type { Claim, ClaimStatusEvent, ClaimSummary } from '@northwind/contracts';

import type { SqliteAdapter } from './sqlite-adapter';

/**
 * Read-through cache of server claims so the dashboard and detail screens still render the
 * last known state while offline. The server remains the source of truth; these rows are
 * only ever refreshed from GET responses.
 */

export async function cacheClaimSummaries(db: SqliteAdapter, summaries: ClaimSummary[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const s of summaries) {
      await db.runAsync(
        `INSERT INTO claims_cache (claim_id, reference, policy_number, intake_status, latest_status, created_at, updated_at, cached_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT (claim_id) DO UPDATE SET
           reference = excluded.reference,
           intake_status = excluded.intake_status,
           latest_status = excluded.latest_status,
           updated_at = excluded.updated_at,
           cached_at = excluded.cached_at`,
        [s.claimId, s.reference, s.intakeStatus, s.latestStatus, s.createdAt, s.createdAt, new Date().toISOString()],
      );
    }
  });
}

export async function cacheClaimDetail(db: SqliteAdapter, claim: Claim): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO claims_cache (claim_id, reference, policy_number, intake_status, latest_status, incident_description, incident_date, created_at, updated_at, cached_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT (claim_id) DO UPDATE SET
         reference = excluded.reference,
         policy_number = excluded.policy_number,
         intake_status = excluded.intake_status,
         incident_description = excluded.incident_description,
         incident_date = excluded.incident_date,
         updated_at = excluded.updated_at,
         cached_at = excluded.cached_at`,
      [claim.claimId, claim.reference, claim.policyNumber, claim.intakeStatus, claim.incidentDescription, claim.incidentDate, claim.createdAt, claim.updatedAt, new Date().toISOString()],
    );
    for (const doc of claim.documents) {
      await db.runAsync(
        `INSERT INTO claim_documents_cache (document_id, claim_id, file_name, content_type, size_bytes, sha256, status, scan_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET status = excluded.status, scan_status = excluded.scan_status`,
        [doc.documentId, claim.claimId, doc.fileName, doc.contentType, doc.sizeBytes, doc.sha256, doc.status, doc.scanStatus],
      );
    }
  });
}

export async function cacheStatusEvents(db: SqliteAdapter, claimId: string, events: ClaimStatusEvent[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM status_events_cache WHERE claim_id = ?`, [claimId]);
    for (const e of events) {
      await db.runAsync(
        `INSERT OR IGNORE INTO status_events_cache (claim_id, at, status, label, source) VALUES (?, ?, ?, ?, ?)`,
        [claimId, e.at, e.status, e.label, e.source],
      );
    }
  });
}

export async function getCachedClaimSummaries(db: SqliteAdapter): Promise<ClaimSummary[]> {
  const rows = await db.getAllAsync<ClaimSummaryShape>(
    `SELECT claim_id, reference, intake_status, latest_status, created_at FROM claims_cache ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    claimId: r.claim_id,
    reference: r.reference,
    intakeStatus: r.intake_status,
    latestStatus: r.latest_status,
    createdAt: r.created_at,
  }));
}

export async function getCachedClaim(db: SqliteAdapter, claimId: string): Promise<Claim | null> {
  const row = await db.getFirstAsync<ClaimShape>(`SELECT * FROM claims_cache WHERE claim_id = ?`, [claimId]);
  if (!row) return null;
  const docs = await db.getAllAsync<DocumentShape>(
    `SELECT * FROM claim_documents_cache WHERE claim_id = ? ORDER BY document_id`,
    [claimId],
  );
  return {
    claimId: row.claim_id,
    reference: row.reference,
    policyNumber: row.policy_number,
    intakeStatus: row.intake_status,
    incidentDescription: row.incident_description,
    incidentDate: row.incident_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documents: docs.map((d) => ({
      documentId: d.document_id,
      fileName: d.file_name,
      contentType: d.content_type,
      sizeBytes: d.size_bytes,
      sha256: d.sha256,
      status: d.status,
      scanStatus: d.scan_status,
    })),
  };
}

export async function getCachedEvents(db: SqliteAdapter, claimId: string): Promise<ClaimStatusEvent[]> {
  const rows = await db.getAllAsync<EventShape>(
    `SELECT at, status, label, source FROM status_events_cache WHERE claim_id = ? ORDER BY at ASC`,
    [claimId],
  );
  return rows.map((r) => ({ at: r.at, status: r.status, label: r.label, source: r.source as 'platform' | 'legacy' }));
}

interface ClaimSummaryShape {
  claim_id: string;
  reference: string;
  intake_status: string;
  latest_status: string | null;
  created_at: string;
}

interface ClaimShape {
  claim_id: string;
  reference: string;
  policy_number: string | null;
  intake_status: string;
  incident_description: string | null;
  incident_date: string | null;
  created_at: string;
  updated_at: string;
}

interface DocumentShape {
  document_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  scan_status: string;
}

interface EventShape {
  at: string;
  status: string;
  label: string;
  source: string;
}
