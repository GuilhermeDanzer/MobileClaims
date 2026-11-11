import type { Claim, CreateClaimRequest, DocumentManifest } from '@northwind/contracts';

import * as attachmentsRepo from '@/db/attachments-repo';
import * as draftsRepo from '@/db/drafts-repo';
import * as queueRepo from '@/db/queue-repo';
import type { SqliteAdapter } from '@/db/sqlite-adapter';
import type { SubmissionRow } from '@/db/types';
import { backoffDelayMs } from './backoff';
import type { SyncErrorKind, UploadInput } from './types';

/**
 * The offline sync orchestrator. Pure logic — no React, no Expo — so it is testable with a
 * fake API and uploader. The React layer (use-sync) supplies the real dependencies and
 * serializes calls (single-flight).
 *
 * Contract enforced here:
 * - claim-first: the metadata POST happens before any upload;
 * - the same `clientClaimId` is reused on every retry (server-side dedup);
 * - a claim is never marked "submitted" locally until the backend confirms;
 * - an interrupted submission/upload is retried, never dropped.
 */

export interface SyncDeps {
  db: SqliteAdapter;
  isSessionCurrent?: () => boolean;
  getToken: () => Promise<string | null>;
  submitClaim: (token: string, request: CreateClaimRequest) => Promise<{ claimId: string; reference: string }>;
  getClaim: (token: string, claimId: string) => Promise<Claim>;
  getUploadUrl: (token: string, claimId: string, documentId: string) => Promise<string>;
  completeDocument: (token: string, claimId: string, documentId: string) => Promise<void>;
  uploadFile: (input: UploadInput, url: string, onProgress?: (sent: number, total: number) => void) => Promise<void>;
  now: () => string;
  isOnline: () => boolean;
  onProgress?: (draftId: string, attachmentId: string, sent: number, total: number) => void;
  /** Overridable for deterministic tests; production uses jittered exponential backoff. */
  backoff?: (attempts: number) => number;
}

export async function runSync(deps: SyncDeps): Promise<boolean> {
  if (!deps.isOnline()) return false;

  const token = await deps.getToken();
  if (!token) return false;

  // Crash recovery: anything in flight when the app died goes back to a retryable state.
  await queueRepo.resetInterruptedSubmissions(deps.db, deps.now());
  await attachmentsRepo.resetInterruptedUploads(deps.db);

  const due = await queueRepo.listDueSubmissions(deps.db, deps.now());
  for (const submission of due) {
    if (deps.isSessionCurrent?.() === false) break;
    await processSubmission(deps, token, submission);
  }
  return due.length > 0;
}

async function processSubmission(deps: SyncDeps, token: string, submission: SubmissionRow): Promise<void> {
  if (!submission.claimId) {
    await submitPhase(deps, token, submission);
    const updated = await queueRepo.getSubmission(deps.db, submission.draftId);
    if (!updated?.claimId) return; // parked, or backed off for retry
    submission = updated;
  }
  await uploadPhase(deps, token, submission);
}

async function submitPhase(deps: SyncDeps, token: string, submission: SubmissionRow): Promise<void> {
  const db = deps.db;
  await queueRepo.markSubmitting(db, submission.draftId);
  try {
    const draft = await draftsRepo.getDraft(db, submission.draftId);
    if (!draft) return;
    const attachments = await attachmentsRepo.listAttachments(db, submission.draftId);

    const request: CreateClaimRequest = {
      clientClaimId: draft.clientClaimId,
      policyNumber: draft.policyNumber,
      incidentDescription: draft.incidentDescription,
      incidentDate: draft.incidentDate,
      documents: attachments.map(
        (a): DocumentManifest => ({
          fileName: a.fileName,
          contentLength: a.sizeBytes,
          contentType: a.contentType as DocumentManifest['contentType'],
          sha256: a.sha256,
        }),
      ),
    };

    const response = await deps.submitClaim(token, request);

    // Persist the acknowledgment before any subsequent read/upload can fail.
    await queueRepo.markMediaPending(db, submission.draftId, {
      claimId: response.claimId, reference: response.reference, acceptedAt: deps.now(),
    });

  } catch (error) {
    await handleSubmitFailure(deps, submission, error);
  }
}

async function handleSubmitFailure(deps: SyncDeps, submission: SubmissionRow, error: unknown): Promise<void> {
  const db = deps.db;
  const kind = classify(error);
  if (kind === 'auth') {
    // The session will flip to signed-out; keep the item retryable for after re-login.
    await queueRepo.markQueuedForRetry(db, submission.draftId, {
      attempts: submission.attempts,
      nextAttemptAt: deps.now(),
      lastError: 'Signed out — will retry',
    });
    return;
  }
  if (kind === 'permanent') {
    await queueRepo.markNeedsAttention(db, submission.draftId, readableReason(error));
    return;
  }
  // transient: timeout, network, 429, 5xx, or an unexpected error.
  const attempts = submission.attempts + 1;
  const nextAttemptAt = futureIso(deps.now(), (deps.backoff ?? backoffDelayMs)(attempts));
  await queueRepo.markQueuedForRetry(db, submission.draftId, {
    attempts,
    nextAttemptAt,
    lastError: readableReason(error),
  });
}

async function uploadPhase(deps: SyncDeps, token: string, submission: SubmissionRow): Promise<void> {
  const db = deps.db;
  const remaining = await attachmentsRepo.listIncompleteAttachments(db, submission.draftId);
  if (remaining.length === 0) {
    await queueRepo.markComplete(db, submission.draftId);
    return;
  }

  for (const attachment of remaining) {
    if (deps.isSessionCurrent?.() === false) return;
    if (!submission.claimId) return;
    try {
      // A previous completion may have committed before the device lost the response.
      const claim = await deps.getClaim(token, submission.claimId);
      if (!attachment.documentId) {
        const document = claim.documents.find((d) => d.fileName === attachment.fileName);
        if (!document) {
          await queueRepo.markNeedsAttention(db, submission.draftId, 'Could not match evidence to the accepted claim');
          return;
        }
        attachment.documentId = document.documentId;
        await attachmentsRepo.setAttachmentDocumentId(db, attachment.attachmentId, document.documentId);
      }
      if (claim.documents.some((d) => d.documentId === attachment.documentId && d.status === 'complete')) {
        await attachmentsRepo.setAttachmentUploadState(db, attachment.attachmentId, 'complete');
        continue;
      }
      const url = await deps.getUploadUrl(token, submission.claimId, attachment.documentId);
      await attachmentsRepo.setAttachmentUploadState(db, attachment.attachmentId, 'uploading');
      await deps.uploadFile({ localUri: attachment.localUri, contentType: attachment.contentType }, url, (sent, total) =>
        deps.onProgress?.(submission.draftId, attachment.attachmentId, sent, total),
      );
      await deps.completeDocument(token, submission.claimId, attachment.documentId);
      await attachmentsRepo.setAttachmentUploadState(db, attachment.attachmentId, 'complete');
    } catch (error) {
      await attachmentsRepo.incrementAttachmentAttempts(db, attachment.attachmentId);
      await attachmentsRepo.setAttachmentUploadState(db, attachment.attachmentId, 'failed');
      if (classify(error) === 'permanent') {
        await queueRepo.markNeedsAttention(db, submission.draftId, readableReason(error));
        return;
      }
      const nextAttemptAt = futureIso(deps.now(), (deps.backoff ?? backoffDelayMs)(attachment.uploadAttempts + 1));
      await queueRepo.deferMediaRetry(db, submission.draftId, { nextAttemptAt, lastError: readableReason(error) });
      return; // partial progress is preserved; the rest retries later
    }
  }

  const after = await attachmentsRepo.listIncompleteAttachments(db, submission.draftId);
  if (after.length === 0) await queueRepo.markComplete(db, submission.draftId);
}

function classify(error: unknown): SyncErrorKind {
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (kind === 'auth' || kind === 'permanent' || kind === 'transient' || kind === 'unknown') return kind;
  return 'transient'; // network errors and unexpected failures are retried
}

function readableReason(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.length > 0 ? message : 'Network or server error';
}

function futureIso(nowIso: string, delayMs: number): string {
  return new Date(new Date(nowIso).getTime() + delayMs).toISOString();
}
