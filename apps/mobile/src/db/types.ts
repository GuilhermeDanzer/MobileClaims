import type { DeviceSubmissionState } from '@northwind/contracts';

/** A locally created claim, persisted before and after submission. */
export interface Draft {
  draftId: string;
  /** Stable across retries — the server-side idempotency key. Minted once, never regenerated. */
  clientClaimId: string;
  policyNumber: string;
  incidentDescription: string;
  /** YYYY-MM-DD. */
  incidentDate: string;
  createdAt: string;
  updatedAt: string;
}

/** A photograph/document attached to a draft. `localUri` points into app document storage. */
export interface Attachment {
  attachmentId: string;
  draftId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  localUri: string;
  /** Server-side document id, known only after the claim is accepted. */
  documentId: string | null;
  uploadState: AttachmentUploadState;
  uploadAttempts: number;
}

export type AttachmentUploadState = 'pending' | 'uploading' | 'uploaded' | 'complete' | 'failed';

/** One row of the submission queue — the customer-visible lifecycle of a submission. */
export interface SubmissionRow {
  draftId: string;
  state: DeviceSubmissionState;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  claimId: string | null;
  reference: string | null;
  acceptedAt: string | null;
}
