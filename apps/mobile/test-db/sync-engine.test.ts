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

test('backoff grows exponentially and caps, with optional jitter', () => {
  assert.equal(backoffDelayMs(0, { jitter: false }), 2000);
  assert.equal(backoffDelayMs(1, { jitter: false }), 4000);
  assert.equal(backoffDelayMs(2, { jitter: false }), 8000);
  assert.equal(backoffDelayMs(20, { jitter: false }), 300_000);
  const jittered = backoffDelayMs(0);
  assert.ok(jittered >= 2000 && jittered <= 2600);
});

test('submits a claim with no attachments and completes it', async () => {
  const fake = makeFakeApi();
  const { draftId, clientClaimId } = await seedSubmission(db);

  await runSync(makeDeps(db, fake));

  const request = fake.calls.submit[0] as { clientClaimId: string; documents: unknown[] };
  assert.equal(request.clientClaimId, clientClaimId);
  assert.deepEqual(request.documents, []);
  const row = await queueRepo.getSubmission(db, draftId);
  assert.equal(row?.state, 'complete');
  assert.equal(row?.reference, 'NW-2026-000001');
});

test('uploads attachments and completes the claim', async () => {
  const fake = makeFakeApi();
  fake.claimDocuments = [{ documentId: 'doc-1', fileName: 'photo-a.jpg', status: 'pending_upload' }];
  const { draftId } = await seedSubmission(db, { attachmentFileNames: ['photo-a.jpg'] });

  await runSync(makeDeps(db, fake));

  assert.equal(fake.calls.submit.length, 1);
  assert.equal(fake.calls.getUploadUrl.length, 1);
  assert.equal(fake.calls.upload.length, 1);
  assert.equal(fake.calls.complete.length, 1);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
});

test('does nothing while offline (forced offline toggle)', async () => {
  const fake = makeFakeApi();
  await seedSubmission(db);

  await runSync(makeDeps(db, fake, { online: false }));

  assert.equal(fake.calls.submit.length, 0);
});

test('skips submission when there is no token (signed out)', async () => {
  const fake = makeFakeApi();
  await seedSubmission(db);

  await runSync(makeDeps(db, fake, { token: null }));

  assert.equal(fake.calls.submit.length, 0);
});

test('recovers an interrupted submission (restart mid-flight) by retrying the same id', async () => {
  const fake = makeFakeApi();
  const { clientClaimId } = await seedSubmission(db, { state: 'submitting' });

  await runSync(makeDeps(db, fake));

  const request = fake.calls.submit[0] as { clientClaimId: string };
  assert.equal(request.clientClaimId, clientClaimId);
});

test('a transient failure retries with the same clientClaimId (duplicate prevention)', async () => {
  const fake = makeFakeApi();
  fake.submitError = { kind: 'transient', message: 'boom' };
  const { draftId, clientClaimId } = await seedSubmission(db);

  const noJitter = (n: number) => backoffDelayMs(n, { jitter: false });
  let currentNow = NOW;
  const clock = () => currentNow;
  await runSync(makeDeps(db, fake, { now: clock, backoff: noJitter }));

  const afterFailure = await queueRepo.getSubmission(db, draftId);
  assert.equal(afterFailure?.state, 'queued');
  assert.equal(afterFailure?.attempts, 1);

  // Recovery: advance past the backoff window and let the backend accept.
  fake.submitError = null;
  currentNow = new Date(new Date(NOW).getTime() + noJitter(1) + 1000).toISOString();
  await runSync(makeDeps(db, fake, { now: clock, backoff: noJitter }));

  const requests = fake.calls.submit as Array<{ clientClaimId: string }>;
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.clientClaimId, clientClaimId);
  assert.equal(requests[1]!.clientClaimId, clientClaimId);
  assert.equal((await queueRepo.getSubmission(db, draftId))?.state, 'complete');
});
