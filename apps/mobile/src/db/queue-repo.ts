import type { DeviceSubmissionState } from '@northwind/contracts';

import type { SqliteAdapter } from './sqlite-adapter';
import type { SubmissionRow } from './types';

/**
 * The submission queue drives the offline sync state machine. State values are the shared
 * `deviceSubmissionStates` vocabulary, minus `draft`-only and transient values as noted.
 */

/** Move a saved draft into the send queue (customer tapped Submit). */
export async function enqueueDraft(db: SqliteAdapter, draftId: string, now: string): Promise<void> {
  await db.runAsync(
    `UPDATE submission_queue SET state = 'queued', next_attempt_at = ?, last_error = NULL WHERE draft_id = ? AND state IN ('draft', 'needs_attention') AND claim_id IS NULL`,
    [now, draftId],
  );
}

export async function getSubmission(db: SqliteAdapter, draftId: string): Promise<SubmissionRow | null> {
  const row = await db.getFirstAsync<SubmissionRowShape>(`SELECT * FROM submission_queue WHERE draft_id = ?`, [draftId]);
  return row ? mapRow(row) : null;
}

/** Rows ready to be worked: waiting to submit, or accepted-but-awaiting-upload. */
export async function listDueSubmissions(db: SqliteAdapter, now: string): Promise<SubmissionRow[]> {
  const rows = await db.getAllAsync<SubmissionRowShape>(
    `SELECT * FROM submission_queue
     WHERE state IN ('queued', 'media_pending') AND next_attempt_at <= ?
     ORDER BY next_attempt_at`,
    [now],
  );
  return rows.map(mapRow);
}

export async function markSubmitting(db: SqliteAdapter, draftId: string): Promise<void> {
  await db.runAsync(`UPDATE submission_queue SET state = 'submitting' WHERE draft_id = ?`, [draftId]);
}

/** Claim POST failed transiently: back off and stay queued (same clientClaimId on retry). */
export async function markQueuedForRetry(
  db: SqliteAdapter,
  draftId: string,
  input: { attempts: number; nextAttemptAt: string; lastError: string },
): Promise<void> {
  await db.runAsync(
    `UPDATE submission_queue SET state = 'queued', attempts = ?, next_attempt_at = ?, last_error = ? WHERE draft_id = ?`,
    [input.attempts, input.nextAttemptAt, input.lastError, draftId],
  );
}

/** Claim accepted by the backend; photographs still need uploading. */
export async function markMediaPending(
  db: SqliteAdapter,
  draftId: string,
  input: { claimId: string; reference: string; acceptedAt: string },
): Promise<void> {
  await db.runAsync(
    `UPDATE submission_queue
     SET state = 'media_pending', claim_id = ?, reference = ?, accepted_at = ?, last_error = NULL
     WHERE draft_id = ?`,
    [input.claimId, input.reference, input.acceptedAt, draftId],
  );
}

/** An upload failed: stay media_pending but retry later. */
export async function deferMediaRetry(db: SqliteAdapter, draftId: string, input: { nextAttemptAt: string; lastError: string }): Promise<void> {
  await db.runAsync(
    `UPDATE submission_queue SET next_attempt_at = ?, last_error = ? WHERE draft_id = ?`,
    [input.nextAttemptAt, input.lastError, draftId],
  );
}

/** A permanent failure (validation, rejection): park for the customer to correct. */
export async function markNeedsAttention(db: SqliteAdapter, draftId: string, lastError: string): Promise<void> {
  await db.runAsync(
    `UPDATE submission_queue SET state = 'needs_attention', last_error = ? WHERE draft_id = ?`,
    [lastError, draftId],
  );
}

/** Everything is done: claim accepted and every photograph confirmed. */
export async function markComplete(db: SqliteAdapter, draftId: string): Promise<void> {
  await db.runAsync(`UPDATE submission_queue SET state = 'complete', last_error = NULL WHERE draft_id = ?`, [draftId]);
}

/** Crash recovery: a submission in flight when the app died is retried (idempotent POST). */
export async function resetInterruptedSubmissions(db: SqliteAdapter, now: string): Promise<void> {
  await db.runAsync(
    `UPDATE submission_queue SET state = 'queued', next_attempt_at = ? WHERE state = 'submitting'`,
    [now],
  );
}

/** A local submission as shown on the dashboard (draft or in-flight). */
export interface DashboardSubmissionRow {
  draftId: string;
  state: DeviceSubmissionState;
  claimId: string | null;
  reference: string | null;
  policyNumber: string;
  updatedAt: string;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: string;
  pendingFiles: { attachmentId: string; fileName: string; uploadState: string }[];
}

export async function listDashboardSubmissions(db: SqliteAdapter): Promise<DashboardSubmissionRow[]> {
  const rows = await db.getAllAsync<DashboardSubmissionShape>(
    `SELECT s.draft_id, s.state, s.claim_id, s.reference, d.policy_number, d.updated_at, s.last_error, s.attempts, s.next_attempt_at
     FROM submission_queue s JOIN drafts d ON d.draft_id = s.draft_id
     ORDER BY d.updated_at DESC`,
  );
  const attachments = await db.getAllAsync<{ draft_id: string; attachment_id: string; file_name: string; upload_state: string }>(
    "SELECT draft_id, attachment_id, file_name, upload_state FROM draft_attachments WHERE upload_state <> 'complete'",
  );
  return rows.map((r) => ({
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    pendingFiles: attachments.filter((a) => a.draft_id === r.draft_id).map((a) => ({ attachmentId: a.attachment_id, fileName: a.file_name, uploadState: a.upload_state })),
    draftId: r.draft_id,
    state: r.state,
    claimId: r.claim_id,
    reference: r.reference,
    policyNumber: r.policy_number,
    updatedAt: r.updated_at,
    lastError: r.last_error,
  }));
}

interface DashboardSubmissionShape {
  attempts: number;
  next_attempt_at: string;
  draft_id: string;
  state: DeviceSubmissionState;
  claim_id: string | null;
  reference: string | null;
  policy_number: string;
  updated_at: string;
  last_error: string | null;
}

interface SubmissionRowShape {
  draft_id: string;
  state: SubmissionRow['state'];
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  claim_id: string | null;
  reference: string | null;
  accepted_at: string | null;
}

function mapRow(row: SubmissionRowShape): SubmissionRow {
  return {
    draftId: row.draft_id,
    state: row.state,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    claimId: row.claim_id,
    reference: row.reference,
    acceptedAt: row.accepted_at,
  };
}

/** Customer-requested retry of accepted media; never goes back through claim creation. */
export async function retryMedia(db: SqliteAdapter, draftId: string, now: string): Promise<void> {
  await db.runAsync(`UPDATE submission_queue SET state = 'media_pending', next_attempt_at = ?, last_error = NULL
    WHERE draft_id = ? AND claim_id IS NOT NULL AND state IN ('media_pending', 'needs_attention')`, [now, draftId]);
}
