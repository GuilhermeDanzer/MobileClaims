import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';

import * as attachmentsRepo from '../src/db/attachments-repo';
import * as queueRepo from '../src/db/queue-repo';
import { initDatabase } from '../src/db/schema';
import type { SqliteAdapter } from '../src/db/sqlite-adapter';
import { backoffDelayMs } from '../src/features/sync/backoff';
import { runSync } from '../src/features/sync/sync-engine';
import { createNodeSqliteAdapter, newMemoryDb } from './node-sqlite-adapter';
import { makeDeps, makeFakeApi, seedSubmission } from './sync-helpers';

let db: SqliteAdapter;
let raw: DatabaseSync;

const NOW = '2026-11-05T10:00:00.000Z';

beforeEach(async () => {
  raw = newMemoryDb();
  db = createNodeSqliteAdapter(raw);
  await initDatabase(db);
});

test('a permanent failure parks the submission with a readable reason', async () => {
  const fake = makeFakeApi();
  fake.submitError = { kind: 'permanent', message: 'policy number unknown' };
  const { draftId } = await seedSubmission(db);

  await runSync(makeDeps(db, fake));

  const row = await queueRepo.getSubmission(db, draftId);
  assert.equal(row?.state, 'needs_attention');
  assert.equal(row?.lastError, 'policy number unknown');
});

test('an auth failure keeps the submission retryable', async () => {
  const fake = makeFakeApi();
  fake.submitError = { kind: 'auth', message: 'expired' };
  const { draftId } = await seedSubmission(db);

  await runSync(makeDeps(db, fake));

  const row = await queueRepo.getSubmission(db, draftId);
  assert.equal(row?.state, 'queued');
  assert.match(row?.lastError ?? '', /Signed out/);
});

test('an interrupted upload recovers and preserves partial progress', async () => {
  const fake = makeFakeApi();
  fake.claimDocuments = [
    { documentId: 'doc-1', fileName: 'a.jpg', status: 'pending_upload' },
    { documentId: 'doc-2', fileName: 'b.jpg', status: 'pending_upload' },
  ];
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['a.jpg', 'b.jpg'] });

  // First upload (a.jpg) succeeds; the second (b.jpg) fails.
  const noJitter = (n: number) => backoffDelayMs(n, { jitter: false });
  fake.uploadFailOn = 'b.jpg';
  let currentNow = NOW;
  const clock = () => currentNow;
  await runSync(makeDeps(db, fake, { now: clock, backoff: noJitter }));

  const after = await queueRepo.getSubmission(db, draftId);
  assert.equal(after?.state, 'media_pending');
  // a.jpg succeeded, b.jpg was attempted and failed.
  assert.equal(fake.calls.upload.length, 2);

  // Clear the injected failure and advance past the backoff.
  fake.uploadFailOn = null;
  currentNow = new Date(new Date(NOW).getTime() + noJitter(2) + 1000).toISOString();
  await runSync(makeDeps(db, fake, { now: clock, backoff: noJitter }));

  assert.equal(fake.calls.upload.length, 3);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
});

test('a claim whose documents are already complete skips re-uploading', async () => {
  const fake = makeFakeApi();
  fake.claimDocuments = [{ documentId: 'doc-1', fileName: 'a.jpg', status: 'complete' }];
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });

  await runSync(makeDeps(db, fake));

  assert.equal(fake.calls.upload.length, 0);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
  const attachment = (await attachmentsRepo.listAttachments(db, draftId))[0];
  assert.equal(attachment?.uploadState, 'complete');
});

test('restart after lost completion response uses server state and never requests an already-complete upload', async () => {
  const fake = makeFakeApi();
  fake.claimDocuments = [{ documentId: 'doc-1', fileName: 'a.jpg', status: 'pending_upload' }];
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });
  const deps = makeDeps(db, fake, { backoff: () => 0 });
  deps.completeDocument = async () => {
    fake.claimDocuments[0]!.status = 'complete';
    throw new Error('connection lost after server committed');
  };
  await runSync(deps);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'media_pending');
  await runSync(makeDeps(db, fake));
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
  assert.equal(fake.calls.getUploadUrl.length, 1);
  assert.equal(fake.calls.upload.length, 1);
  assert.equal(fake.calls.submit.length, 1);
});

test('missing document mapping is visible and never marked complete', async () => {
  const fake = makeFakeApi();
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['missing.jpg'] });
  await runSync(makeDeps(db, fake));
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'needs_attention');
  assert.equal(fake.calls.upload.length, 0);
});

test('acceptance survives failed document lookup and resumes without a second claim POST', async () => {
  const fake = makeFakeApi();
  fake.claimDocuments = [{ documentId: 'doc-1', fileName: 'a.jpg', status: 'pending_upload' }];
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });
  const deps = makeDeps(db, fake, { backoff: () => 0 });
  deps.getClaim = async () => { throw new Error('backend unavailable after acceptance'); };
  await runSync(deps);
  const accepted = await queueRepo.getSubmission(db, draftId);
  assert.equal(accepted?.state, 'media_pending');
  assert.equal(accepted?.claimId, fake.submitResult.claimId);
  await runSync(makeDeps(db, fake));
  assert.equal(fake.calls.submit.length, 1);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
});

test('policy rejection preserves the original draft and evidence for correction', async () => {
  const fake = makeFakeApi();
  fake.submitError = { kind: 'permanent', message: 'Select an active policy and try again' };
  const seeded = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });
  await runSync(makeDeps(db, fake));
  const drafts = await import('../src/db/drafts-repo');
  assert.equal((await drafts.getDraft(db, seeded.draftId))?.clientClaimId, seeded.clientClaimId);
  assert.equal((await attachmentsRepo.listAttachments(db, seeded.draftId)).length, 1);
  assert.equal((await queueRepo.getSubmission(db, seeded.draftId))?.state, 'needs_attention');
  fake.submitError = null;
  fake.claimDocuments = [{ documentId: 'd', fileName: 'a.jpg', status: 'pending_upload' }];
  await queueRepo.enqueueDraft(db, seeded.draftId, NOW);
  await runSync(makeDeps(db, fake));
  assert.equal((await queueRepo.getSubmission(db, seeded.draftId))?.state, 'complete');
});

test('account change stops the current run before the next queued operation', async () => {
  const fake = makeFakeApi();
  const first = await seedSubmission(db);
  const second = await seedSubmission(db);
  const deps = makeDeps(db, fake);
  let active = true;
  const submit = deps.submitClaim;
  deps.isSessionCurrent = () => active;
  deps.submitClaim = async (...args) => { const response = await submit(...args); active = false; return response; };
  await runSync(deps);
  assert.equal(fake.calls.submit.length, 1);
  assert.equal((await queueRepo.getSubmission(db, second.draftId))?.state, 'queued');
  assert.equal((await queueRepo.getSubmission(db, first.draftId))?.claimId, fake.submitResult.claimId);
});

test('manual media retry preserves acceptance and never re-posts the claim', async () => {
  const fake = makeFakeApi();
  fake.claimDocuments = [{ documentId: 'd', fileName: 'a.jpg', status: 'pending_upload' }];
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });
  const deps = makeDeps(db, fake);
  deps.uploadFile = async () => { throw { kind: 'permanent', message: 'A saved attachment is missing' }; };
  await runSync(deps);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'needs_attention');
  await queueRepo.retryMedia(db, draftId, NOW);
  await runSync(makeDeps(db, fake));
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
  assert.equal(fake.calls.submit.length, 1);
});
