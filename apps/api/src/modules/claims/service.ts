import { randomUUID } from 'node:crypto';

import type { S3Client } from '@aws-sdk/client-s3';
import type { Claim, ClaimStatusEvent, CreateClaimRequest, DocumentUpload } from '@northwind/contracts';
import type { Pool, PoolClient } from 'pg';

import * as claimsRepo from '../../db/claims-repo';
import * as outboxRepo from '../../db/outbox-repo';
import type { ClaimRow, DocumentRow } from '../../db/claims-repo';
import { headObject, presignPut } from '../../object-storage';
import { badRequest, notFound } from '../../platform/errors';
import { nextReference } from './reference';

export interface ClaimsService {
  createClaim(
    customerId: string,
    input: CreateClaimRequest,
    connection?: PoolClient,
  ): Promise<{
    created: boolean;
    claimId: string;
    reference: string;
    intakeStatus: string;
    createdAt: string;
    uploads: DocumentUpload[];
  }>;
  getClaim(customerId: string, claimId: string): Promise<Claim>;
  listClaims(customerId: string): Promise<ClaimSummary[]>;
  getStatusEvents(customerId: string, claimId: string): Promise<ClaimStatusEvent[]>;
  completeDocument(customerId: string, claimId: string, documentId: string): Promise<{ documentId: string; status: string }>;
  presignDocumentUpload(customerId: string, claimId: string, documentId: string): Promise<DocumentUpload>;
}

export interface ClaimSummary {
  claimId: string;
  reference: string;
  intakeStatus: string;
  latestStatus: string | null;
  createdAt: string;
}

export function createClaimsService(deps: { pool: Pool; s3: S3Client; bucket: string }): ClaimsService {
  return {
    async createClaim(customerId, input, connection) {
      if (new Set(input.documents.map((d) => d.fileName)).size !== input.documents.length) {
        throw badRequest('Document filenames must be unique');
      }
      const client = connection ?? await deps.pool.connect();
      try {
        await client.query('BEGIN');
        const reference = await nextReference(client);

        const inserted = await claimsRepo.insertClaim(client, {
          customerId,
          clientClaimId: input.clientClaimId,
          reference,
          policyNumber: input.policyNumber,
          incidentDescription: input.incidentDescription,
          incidentDate: input.incidentDate,
        });

        if (!inserted) {
          // Idempotent replay (ADR-004): the unique index already saw this clientClaimId.
          await client.query('COMMIT');
          const existing = await claimsRepo.getClaimByClientId(client, customerId, input.clientClaimId);
          if (!existing) throw badRequest('claim vanished after conflict');
          return {
            created: false,
            claimId: existing.claim_id,
            reference: existing.reference,
            intakeStatus: existing.intake_status,
            createdAt: existing.created_at.toISOString(),
            uploads: [],
          };
        }

        // Enforce the same ownership/active boundary used by policy selection. Replay
        // above remains valid even if the policy changed after the original acceptance.
        const policy = await client.query<{ active: boolean }>(
          'SELECT active FROM policies WHERE customer_id = $1 AND policy_number = $2 FOR SHARE',
          [customerId, input.policyNumber],
        );
        if (policy.rows[0]?.active !== true) {
          throw badRequest('This policy is no longer available for submission. Select an active policy and try again.', 'POLICY_UNAVAILABLE');
        }

        if (input.documents.length > 0) {
          await client.query("UPDATE claims SET intake_status = 'media_pending' WHERE claim_id = $1", [inserted.claim_id]);
          inserted.intake_status = 'media_pending';
        }
        // New claim: documents, status event, and outbox event commit atomically.
        const uploads: DocumentUpload[] = [];
        for (const doc of input.documents) {
          const storageKey = `claims/${customerId}/${inserted.claim_id}/${randomUUID()}`;
          const document = await claimsRepo.insertDocument(client, {
            claimId: inserted.claim_id,
            storageKey,
            fileName: doc.fileName,
            contentType: doc.contentType,
            sizeBytes: doc.contentLength,
            sha256: doc.sha256,
          });
          const uploadUrl = await presignPut(deps.s3, deps.bucket, {
            key: storageKey,
            contentLength: doc.contentLength,
            contentType: doc.contentType,
          });
          uploads.push({ documentId: document.document_id, uploadUrl });
        }

        await claimsRepo.insertStatusEvent(client, {
          claimId: inserted.claim_id,
          status: 'received',
          label: 'Claim received',
          source: 'platform',
        });
        await outboxRepo.insertOutboxEvent(client, {
          aggregateId: inserted.claim_id,
          eventType: 'ClaimSubmitted',
          payload: { claimId: inserted.claim_id, reference, customerId },
        });

        await client.query('COMMIT');
        return {
          created: true,
          claimId: inserted.claim_id,
          reference: inserted.reference,
          intakeStatus: inserted.intake_status,
          createdAt: inserted.created_at.toISOString(),
          uploads,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        if (!connection) client.release();
      }
    },

    async getClaim(customerId, claimId) {
      const row = await claimsRepo.getClaimById(deps.pool, customerId, claimId);
      if (!row) throw notFound('Claim not found');
      return toClaim(deps.pool, row);
    },

    async listClaims(customerId) {
      const rows = await claimsRepo.listClaims(deps.pool, customerId);
      return rows.map((row) => ({
        claimId: row.claim_id,
        reference: row.reference,
        intakeStatus: row.intake_status,
        latestStatus: row.latest_status,
        createdAt: row.created_at.toISOString(),
      }));
    },

    async getStatusEvents(customerId, claimId) {
      const row = await claimsRepo.getClaimById(deps.pool, customerId, claimId);
      if (!row) throw notFound('Claim not found');
      const events = await claimsRepo.listStatusEvents(deps.pool, claimId);
      return events.map((event) => ({
        status: event.status,
        label: event.label,
        at: event.at.toISOString(),
        source: event.source as 'platform' | 'legacy',
      }));
    },

    async completeDocument(customerId, claimId, documentId) {
      const claim = await claimsRepo.getClaimById(deps.pool, customerId, claimId);
      if (!claim) throw notFound('Claim not found');
      const doc = await claimsRepo.getDocument(deps.pool, claimId, documentId);
      if (!doc) throw notFound('Document not found');

      const object = await headObject(deps.s3, deps.bucket, doc.storage_key);
      if (!object) throw badRequest('document has not been uploaded', 'DOCUMENT_NOT_UPLOADED');
      if (object.size !== doc.size_bytes || object.contentType !== doc.content_type) {
        throw badRequest('uploaded object does not match declared size or type', 'DOCUMENT_MISMATCH');
      }

      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT claim_id FROM claims WHERE claim_id = $1 FOR UPDATE', [claimId]);
        await claimsRepo.markDocumentComplete(client, claimId, documentId);
        await client.query(`UPDATE claims SET intake_status = 'received', updated_at = now()
          WHERE claim_id = $1 AND intake_status = 'media_pending'
          AND NOT EXISTS (SELECT 1 FROM claim_documents WHERE claim_id = $1 AND status <> 'complete')`, [claimId]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return { documentId, status: 'complete' };
    },

    async presignDocumentUpload(customerId, claimId, documentId) {
      const claim = await claimsRepo.getClaimById(deps.pool, customerId, claimId);
      if (!claim) throw notFound('Claim not found');
      const doc = await claimsRepo.getDocument(deps.pool, claimId, documentId);
      if (!doc) throw notFound('Document not found');
      if (doc.status === 'complete') {
        throw badRequest('document is already uploaded', 'DOCUMENT_ALREADY_COMPLETE');
      }

      // Re-issue a fresh presigned PUT (same TTL and signed length/type constraints as at
      // creation) so the app can retry an expired or interrupted upload without re-submitting.
      const uploadUrl = await presignPut(deps.s3, deps.bucket, {
        key: doc.storage_key,
        contentLength: doc.size_bytes,
        contentType: doc.content_type,
      });
      return { documentId, uploadUrl };
    },
  };
}

async function toClaim(db: Pool, row: ClaimRow): Promise<Claim> {
  const documents = await claimsRepo.listDocuments(db, row.claim_id);
  return {
    claimId: row.claim_id,
    reference: row.reference,
    policyNumber: row.policy_number,
    intakeStatus: row.intake_status,
    incidentDescription: row.incident_description,
    incidentDate: row.incident_date,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    documents: documents.map(toDocument),
  };
}

function toDocument(doc: DocumentRow) {
  return {
    documentId: doc.document_id,
    fileName: doc.file_name,
    contentType: doc.content_type,
    sizeBytes: doc.size_bytes,
    sha256: doc.sha256,
    status: doc.status,
    scanStatus: doc.scan_status,
  };
}
