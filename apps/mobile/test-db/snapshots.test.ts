import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initDatabase } from '../src/db/schema';
import { databaseName, customerScope } from '../src/db/ownership';
import { readSnapshot, writeSnapshot, snapshotExpired, POLICY_TTL_MS } from '../src/db/snapshots-repo';
import { getDraft } from '../src/db/drafts-repo';
import { getSubmission, enqueueDraft } from '../src/db/queue-repo';
import { runSync } from '../src/features/sync/sync-engine';
import { createNodeSqliteAdapter } from './node-sqlite-adapter';
import { seedSubmission, makeDeps, makeFakeApi } from './sync-helpers';

const filename = (owner: string | null) => databaseName(owner, async (value) => createHash('sha256').update(value).digest('hex'));
const token = (iss: string, sub: string) => `header.${Buffer.from(JSON.stringify({ iss, sub })).toString('base64url')}.signature`;

test('ownership is stable across tokens, issuer scoped, path safe and fails closed', async () => {
  const a = customerScope(token('issuer', 'A'));
  assert.equal(a, customerScope(token('issuer', 'A')));
  assert.notEqual(await filename(a), await filename(customerScope(token('issuer', 'B'))));
  assert.notEqual(await filename(a), await filename(customerScope(token('other', 'A'))));
  assert.doesNotMatch(await filename('../a'), /[/\\]/);
  assert.equal(customerScope('malformed'), null);
  await assert.rejects(filename(null), /Sign in/);
});

test('online snapshots and pending attachments survive cold restart; B is isolated and A resumes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'northwind-cache-'));
  let raw = new DatabaseSync(join(dir, await filename('A')));
  try {
    let db = createNodeSqliteAdapter(raw);
    await initDatabase(db);
    const pending = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });
    const resources = {
      'claims:list': [{ claimId: 'claim-1', latestStatus: 'under_review' }],
      'claims:detail:claim-1': { claimId: 'claim-1', updatedAt: '2026-11-07T12:00:00Z', documents: [] },
      'claims:events:claim-1': [{ at: '2026-11-07T12:00:00Z', status: 'under_review' }],
      'policies:list': [{ policyNumber: 'P1', active: true }],
    };
    for (const [key, data] of Object.entries(resources)) await writeSnapshot(db, key, { data, fetchedAt: 100 });
    raw.close();
    raw = new DatabaseSync(join(dir, await filename('A')));
    db = createNodeSqliteAdapter(raw);
    await initDatabase(db);
    for (const [key, data] of Object.entries(resources)) assert.deepEqual(await readSnapshot(db, key), { data, fetchedAt: 100 });
    const bRaw = new DatabaseSync(join(dir, await filename('B')));
    try {
      const b = createNodeSqliteAdapter(bRaw);
      await initDatabase(b);
      assert.equal(await readSnapshot(b, 'claims:list'), null);
      assert.equal(await getDraft(b, pending.draftId), null);
      const fake = makeFakeApi();
      await runSync(makeDeps(b, fake, { token: 'customer-B' }));
      assert.equal(fake.calls.submit.length, 0);
      assert.equal((await getSubmission(db, pending.draftId))?.state, 'queued');
    } finally { bRaw.close(); }
    assert.equal((await getDraft(db, pending.draftId))?.clientClaimId, pending.clientClaimId);
    const fake = makeFakeApi();
    fake.claimDocuments = [{ documentId: 'd', fileName: 'a.jpg', status: 'pending_upload' }];
    await runSync(makeDeps(db, fake, { token: 'customer-A' }));
    assert.equal(fake.calls.submit.length, 1);
    assert.equal((await getSubmission(db, pending.draftId))?.state, 'complete');
    await enqueueDraft(db, pending.draftId, new Date().toISOString());
    assert.equal((await getSubmission(db, pending.draftId))?.state, 'complete');
  } finally { raw.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('reconnection replaces stale snapshots, late responses cannot overwrite newer data, TTL never deletes availability', async () => {
  const raw = new DatabaseSync(':memory:');
  try {
    const db = createNodeSqliteAdapter(raw);
    await initDatabase(db);
    assert.equal(await readSnapshot(db, 'policies:list'), null);
    await writeSnapshot(db, 'policies:list', { data: ['old'], fetchedAt: 100 });
    assert.equal(snapshotExpired(100, 100 + POLICY_TTL_MS - 1), false);
    assert.equal(snapshotExpired(100, 100 + POLICY_TTL_MS), true);
    assert.deepEqual((await readSnapshot(db, 'policies:list'))?.data, ['old']);
    await writeSnapshot(db, 'policies:list', { data: ['new'], fetchedAt: 200 });
    await writeSnapshot(db, 'policies:list', { data: ['late'], fetchedAt: 150 });
    assert.deepEqual(await readSnapshot(db, 'policies:list'), { data: ['new'], fetchedAt: 200 });
    await db.runAsync("UPDATE read_snapshots SET payload = 'broken'");
    assert.equal(await readSnapshot(db, 'policies:list'), null);
  } finally { raw.close(); }
});

test('v1 upgrade preserves pending claims and creates the response snapshot table', async () => {
  const raw = new DatabaseSync(':memory:');
  try {
    const db = createNodeSqliteAdapter(raw);
    await initDatabase(db);
    const pending = await seedSubmission(db, { attachmentFileNames: ['a.jpg'] });
    await db.execAsync('DROP TABLE read_snapshots; PRAGMA user_version = 1;');
    await initDatabase(db);
    assert.equal((await getSubmission(db, pending.draftId))?.state, 'queued');
    assert.equal((await getDraft(db, pending.draftId))?.clientClaimId, pending.clientClaimId);
    await writeSnapshot(db, 'claims:list', { data: [], fetchedAt: 1 });
    assert.deepEqual((await readSnapshot(db, 'claims:list'))?.data, []);
  } finally { raw.close(); }
});
