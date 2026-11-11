import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';

import * as cacheRepo from '../src/db/claims-cache-repo';
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

test('caches claim summaries and returns them for offline display', async () => {
  await cacheRepo.cacheClaimSummaries(db, [
    { claimId: 'claim-1', reference: 'NW-2026-000001', intakeStatus: 'legacy_accepted', latestStatus: 'under_review', createdAt: NOW },
  ]);

  const summaries = await cacheRepo.getCachedClaimSummaries(db);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.latestStatus, 'under_review');
});

test('caches a claim detail and its status events', async () => {
  const claim = {
    claimId: 'claim-1',
    reference: 'NW-2026-000001',
    policyNumber: 'POL-HOME-0001',
    intakeStatus: 'legacy_accepted',
    incidentDescription: 'Hail damage',
    incidentDate: '2026-11-03',
    createdAt: NOW,
    updatedAt: NOW,
    documents: [
      { documentId: 'doc-1', fileName: 'roof.jpg', contentType: 'image/jpeg', sizeBytes: 2, sha256: 'a'.repeat(64), status: 'complete', scanStatus: 'not_scanned' },
    ],
  };
  await cacheRepo.cacheClaimDetail(db, claim);
  await cacheRepo.cacheStatusEvents(db, 'claim-1', [
    { at: NOW, status: 'received', label: 'Claim received', source: 'platform' as const },
  ]);

  const cached = await cacheRepo.getCachedClaim(db, 'claim-1');
  assert.equal(cached?.documents[0]!.status, 'complete');
  const events = await cacheRepo.getCachedEvents(db, 'claim-1');
  assert.equal(events[0]!.status, 'received');
});

test('replacing status events drops stale rows', async () => {
  await cacheRepo.cacheStatusEvents(db, 'claim-1', [
    { at: NOW, status: 'received', label: 'Claim received', source: 'platform' as const },
  ]);
  await cacheRepo.cacheStatusEvents(db, 'claim-1', [
    { at: NOW, status: 'under_review', label: 'Under review', source: 'legacy' as const },
  ]);

  const events = await cacheRepo.getCachedEvents(db, 'claim-1');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.status, 'under_review');
});
