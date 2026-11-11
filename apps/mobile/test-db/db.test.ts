import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';

import * as attachmentsRepo from '../src/db/attachments-repo';
import * as draftsRepo from '../src/db/drafts-repo';
import * as queueRepo from '../src/db/queue-repo';
import { initDatabase } from '../src/db/schema';
import type { SqliteAdapter } from '../src/db/sqlite-adapter';
import { createNodeSqliteAdapter, newMemoryDb } from './node-sqlite-adapter';

let db: SqliteAdapter;
let raw: DatabaseSync;

const NOW = '2026-11-05T10:00:00.000Z';

beforeEach(async () => {
  raw = newMemoryDb();
  db = createNodeSqliteAdapter(raw);
  await initDatabase(db);
});

function baseDraft(overrides: Partial<draftsRepo.CreateDraftInput> = {}): draftsRepo.CreateDraftInput {
  return {
    draftId: 'draft-1',
    clientClaimId: '00000000-0000-0000-0000-000000000001',
    policyNumber: 'POL-HOME-0001',
    incidentDescription: 'Hail damage to the roof',
    incidentDate: '2026-11-03',
    now: NOW,
    ...overrides,
  };
}

const attachment = {
  attachmentId: 'att-1',
  draftId: 'draft-1',
  fileName: 'roof.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  localUri: 'file:///documents/draft-1/roof.jpg',
};

test('migrations create the schema once and are idempotent', async () => {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  assert.equal(version?.user_version, 2);

  await initDatabase(db);
  const again = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  assert.equal(again?.user_version, 2);
});

test('creates a draft with its queue row atomically', async () => {
  await draftsRepo.createDraft(db, baseDraft());

  const draft = await draftsRepo.getDraft(db, 'draft-1');
  assert.equal(draft?.clientClaimId, '00000000-0000-0000-0000-000000000001');

  const submission = await queueRepo.getSubmission(db, 'draft-1');
  assert.equal(submission?.state, 'draft');
});

test('enforces client_claim_id uniqueness (duplicate-submission guard)', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await assert.rejects(() => draftsRepo.createDraft(db, baseDraft({ draftId: 'draft-2' })));
});

test('persists photo metadata and lists attachments', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await attachmentsRepo.addAttachment(db, attachment);

  const attachments = await attachmentsRepo.listAttachments(db, 'draft-1');
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]!.sha256, 'a'.repeat(64));
  assert.equal(attachments[0]!.uploadState, 'pending');
});

test('updates draft fields and reflects the change', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await draftsRepo.updateDraft(db, 'draft-1', { incidentDescription: 'Wind damage', now: NOW });

  const draft = await draftsRepo.getDraft(db, 'draft-1');
  assert.equal(draft?.incidentDescription, 'Wind damage');
});

test('deleting a draft cascades to attachments and the queue row', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await attachmentsRepo.addAttachment(db, attachment);

  await draftsRepo.deleteDraft(db, 'draft-1');
  assert.equal(await draftsRepo.getDraft(db, 'draft-1'), null);
  assert.equal(await queueRepo.getSubmission(db, 'draft-1'), null);
  assert.deepEqual(await attachmentsRepo.listAttachments(db, 'draft-1'), []);
});

test('submission lifecycle: enqueue → submitting → accepted → complete', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await queueRepo.enqueueDraft(db, 'draft-1', NOW);

  const due = await queueRepo.listDueSubmissions(db, NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0]!.state, 'queued');

  await queueRepo.markSubmitting(db, 'draft-1');
  await queueRepo.markMediaPending(db, 'draft-1', { claimId: 'claim-1', reference: 'NW-2026-000001', acceptedAt: NOW });
  const pending = await queueRepo.getSubmission(db, 'draft-1');
  assert.equal(pending?.state, 'media_pending');
  assert.equal(pending?.reference, 'NW-2026-000001');

  await queueRepo.markComplete(db, 'draft-1');
  const done = await queueRepo.getSubmission(db, 'draft-1');
  assert.equal(done?.state, 'complete');
});

test('interrupted submission recovers to queued (idempotent retry)', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await queueRepo.enqueueDraft(db, 'draft-1', NOW);
  await queueRepo.markSubmitting(db, 'draft-1');

  await queueRepo.resetInterruptedSubmissions(db, NOW);
  const row = await queueRepo.getSubmission(db, 'draft-1');
  assert.equal(row?.state, 'queued');
});

test('permanent failure parks the submission with a readable reason', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await queueRepo.enqueueDraft(db, 'draft-1', NOW);
  await queueRepo.markNeedsAttention(db, 'draft-1', 'policy number unknown');

  const row = await queueRepo.getSubmission(db, 'draft-1');
  assert.equal(row?.state, 'needs_attention');
  assert.equal(row?.lastError, 'policy number unknown');
});

test('interrupted upload recovers to pending', async () => {
  await draftsRepo.createDraft(db, baseDraft());
  await attachmentsRepo.addAttachment(db, attachment);
  await attachmentsRepo.setAttachmentUploadState(db, 'att-1', 'uploading');

  await attachmentsRepo.resetInterruptedUploads(db);
  const result = await attachmentsRepo.getAttachment(db, 'att-1');
  assert.equal(result?.uploadState, 'pending');
});
