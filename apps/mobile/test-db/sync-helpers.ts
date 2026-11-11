import { randomUUID } from 'node:crypto';

import * as attachmentsRepo from '../src/db/attachments-repo';
import * as draftsRepo from '../src/db/drafts-repo';
import * as queueRepo from '../src/db/queue-repo';
import type { SqliteAdapter } from '../src/db/sqlite-adapter';
import type { SyncDeps } from '../src/features/sync/sync-engine';

/** A mutable fake API/uploader that records calls and can be steered per test. */
export interface FakeApi {
  calls: { submit: unknown[]; upload: unknown[]; complete: unknown[]; getUploadUrl: unknown[] };
  submitResult: { claimId: string; reference: string };
  submitError: { kind: string; message: string } | null;
  claimDocuments: Array<{ documentId: string; fileName: string; status: string }>;
  /** Fail the upload whose localUri contains this substring. */
  uploadFailOn: string | null;
}

export function makeFakeApi(): FakeApi {
  return {
    calls: { submit: [], upload: [], complete: [], getUploadUrl: [] },
    submitResult: { claimId: 'claim-1', reference: 'NW-2026-000001' },
    submitError: null,
    claimDocuments: [],
    uploadFailOn: null,
  };
}

export function makeDeps(
  db: SqliteAdapter,
  fake: FakeApi,
  opts: { now?: () => string; online?: boolean; token?: string | null; backoff?: (n: number) => number } = {},
): SyncDeps {
  const now = opts.now ?? (() => '2026-11-05T10:00:00.000Z');
  const online = opts.online ?? true;
  const token = opts.token === undefined ? 'token-123' : opts.token;
  return {
    db,
    getToken: async () => token,
    submitClaim: async (_token, request) => {
      fake.calls.submit.push(request);
      if (fake.submitError) throw fake.submitError;
      return fake.submitResult;
    },
    getClaim: async (_token, claimId) => ({
      claimId,
      reference: fake.submitResult.reference,
      policyNumber: 'POL-HOME-0001',
      intakeStatus: 'legacy_accepted',
      incidentDescription: 'Hail damage',
      incidentDate: '2026-11-03',
      createdAt: now(),
      updatedAt: now(),
      documents: fake.claimDocuments.map((d) => ({
        documentId: d.documentId,
        fileName: d.fileName,
        contentType: 'image/jpeg',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        status: d.status,
        scanStatus: 'not_scanned',
      })),
    }),
    getUploadUrl: async (_token, _claimId, documentId) => {
      fake.calls.getUploadUrl.push(documentId);
      return `http://store/${documentId}`;
    },
    completeDocument: async (_token, _claimId, documentId) => {
      fake.calls.complete.push(documentId);
    },
    uploadFile: async (input, _url) => {
      fake.calls.upload.push(input);
      if (fake.uploadFailOn && input.localUri.includes(fake.uploadFailOn)) {
        throw new Error('upload dropped (diagnostics)');
      }
    },
    now,
    isOnline: () => online,
    backoff: opts.backoff,
  };
}

/** Seeds a draft (with optional attachments) and enqueues it for submission. */
export async function seedSubmission(
  db: SqliteAdapter,
  opts: { attachmentFileNames?: string[]; now?: string; state?: 'queued' | 'submitting' } = {},
): Promise<{ draftId: string; clientClaimId: string; attachments: Array<{ attachmentId: string; fileName: string }> }> {
  const now = opts.now ?? '2026-11-05T10:00:00.000Z';
  const draftId = randomUUID();
  const clientClaimId = randomUUID();
  await draftsRepo.createDraft(db, {
    draftId,
    clientClaimId,
    policyNumber: 'POL-HOME-0001',
    incidentDescription: 'Hail damage to the roof',
    incidentDate: '2026-11-03',
    now,
  });

  const attachments = [];
  for (const fileName of opts.attachmentFileNames ?? []) {
    const attachmentId = randomUUID();
    await attachmentsRepo.addAttachment(db, {
      attachmentId,
      draftId,
      fileName,
      contentType: 'image/jpeg',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      localUri: `file:///drafts/${draftId}/${fileName}`,
    });
    attachments.push({ attachmentId, fileName });
  }

  await queueRepo.enqueueDraft(db, draftId, now);
  if (opts.state === 'submitting') await queueRepo.markSubmitting(db, draftId);
  return { draftId, clientClaimId, attachments };
}
