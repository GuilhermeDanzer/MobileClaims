import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';
import type { CreateClaimRequest } from '@northwind/contracts';

import { createClaimsService, type ClaimsService } from '../src/modules/claims/service';
import { createTestStorageClient, insertCustomer, setupTestDb, truncate } from './helpers';
import { ensureBucket } from '../src/object-storage';
import { loadConfig } from '../src/config';

let pool: Pool;
let service: ClaimsService;
let customerId: string;

const JPEG = Buffer.from('fake-jpeg-bytes-for-upload');

function makeRequest(): CreateClaimRequest {
  return {
    clientClaimId: randomUUID(),
    policyNumber: 'POL-HOME-0001',
    incidentDescription: 'Hail damage to the roof',
    incidentDate: '2026-11-03',
    documents: [
      {
        fileName: 'roof.jpg',
        contentLength: JPEG.length,
        contentType: 'image/jpeg',
        sha256: createHash('sha256').update(JPEG).digest('hex'),
      },
    ],
  };
}

before(async () => {
  pool = await setupTestDb();
  const config = loadConfig();
  const s3 = createTestStorageClient();
  await ensureBucket(s3, config.STORAGE_BUCKET);
  service = createClaimsService({ pool, s3, bucket: config.STORAGE_BUCKET });
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool);
  customerId = await insertCustomer(pool, true);
});

test('creates a claim with a reference and presigned upload', async () => {
  const result = await service.createClaim(customerId, makeRequest());
  assert.equal(result.created, true);
  assert.match(result.reference, /^NW-\d{4}-\d{6}$/);
  assert.equal(result.uploads.length, 1);
  assert.match(result.uploads[0]!.uploadUrl, /^http/);
  const signed = new URL(result.uploads[0]!.uploadUrl).searchParams.get('X-Amz-SignedHeaders')!;
  assert.ok(signed.split(';').includes('content-type'));
  assert.ok(signed.split(';').includes('content-length'));
});

test('replays idempotently for the same clientClaimId', async () => {
  const request = makeRequest();
  const first = await service.createClaim(customerId, request);
  const second = await service.createClaim(customerId, request);

  assert.equal(second.created, false);
  assert.equal(second.reference, first.reference);
  assert.equal(second.claimId, first.claimId);

  const count = await pool.query('SELECT count(*)::int AS c FROM claims WHERE customer_id = $1', [customerId]);
  assert.equal(count.rows[0]!.c, 1);
});

test('concurrent duplicate submission yields a single claim', async () => {
  const request = makeRequest();
  const [a, b] = await Promise.all([
    service.createClaim(customerId, request),
    service.createClaim(customerId, request),
  ]);

  const createdCount = [a, b].filter((r) => r.created).length;
  assert.equal(createdCount, 1);
  assert.equal(a.reference, b.reference);

  const count = await pool.query('SELECT count(*)::int AS c FROM claims WHERE customer_id = $1', [customerId]);
  assert.equal(count.rows[0]!.c, 1);
});

test('lists claims and their status events', async () => {
  const created = await service.createClaim(customerId, makeRequest());

  const list = await service.listClaims(customerId);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.reference, created.reference);
  assert.equal(list[0]!.latestStatus, 'received');

  const events = await service.getStatusEvents(customerId, created.claimId);
  assert.equal(events[0]!.status, 'received');
});

test('uploads a document via the presigned URL and marks it complete', async () => {
  const created = await service.createClaim(customerId, makeRequest());
  const upload = created.uploads[0]!;

  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: JPEG,
  });
  assert.ok(response.ok, `upload failed: HTTP ${response.status}`);

  const done = await service.completeDocument(customerId, created.claimId, upload.documentId);
  assert.equal(done.status, 'complete');

  const claim = await service.getClaim(customerId, created.claimId);
  assert.equal(claim.documents[0]!.status, 'complete');
});

test('re-issues an upload URL for a pending document that uploads successfully', async () => {
  const created = await service.createClaim(customerId, makeRequest());
  const documentId = created.uploads[0]!.documentId;

  const fresh = await service.presignDocumentUpload(customerId, created.claimId, documentId);
  assert.equal(fresh.documentId, documentId);
  assert.match(fresh.uploadUrl, /^http/);

  const response = await fetch(fresh.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: JPEG,
  });
  assert.ok(response.ok, `re-issued upload failed: HTTP ${response.status}`);

  const done = await service.completeDocument(customerId, created.claimId, documentId);
  assert.equal(done.status, 'complete');
});

test('refuses to re-issue an upload URL for a completed document', async () => {
  const created = await service.createClaim(customerId, makeRequest());
  const upload = created.uploads[0]!;

  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: JPEG,
  });
  assert.ok(response.ok);
  await service.completeDocument(customerId, created.claimId, upload.documentId);

  await assert.rejects(
    () => service.presignDocumentUpload(customerId, created.claimId, upload.documentId),
    (error: { code?: string }) => error.code === 'DOCUMENT_ALREADY_COMPLETE',
  );
});

test('holds durable outbox until every evidence upload is validated; scan stays not_scanned', async () => {
  const { getUnpublishedOutboxEvents } = await import('../src/db/outbox-repo');
  const request = makeRequest();
  request.documents.push({ ...request.documents[0]!, fileName: 'second.jpg' });
  const created = await service.createClaim(customerId, request);
  assert.equal(created.intakeStatus, 'media_pending');
  assert.equal((await getUnpublishedOutboxEvents(pool)).length, 0);
  for (const [index, upload] of created.uploads.entries()) {
    assert.ok((await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: JPEG })).ok);
    await service.completeDocument(customerId, created.claimId, upload.documentId);
    assert.equal((await getUnpublishedOutboxEvents(pool)).length, index === 0 ? 0 : 1);
  }
  const claim = await service.getClaim(customerId, created.claimId);
  assert.equal(claim.intakeStatus, 'received');
  assert.ok(claim.documents.every((d) => d.scanStatus === 'not_scanned'));
});

test('rejects duplicate filenames before persisting ambiguous evidence', async () => {
  const request = makeRequest();
  request.documents.push(request.documents[0]!);
  await assert.rejects(service.createClaim(customerId, request), /filenames must be unique/);
  assert.equal((await pool.query('SELECT * FROM claims')).rowCount, 0);
});

test('missing object or foreign customer cannot complete evidence or obtain upload URLs', async () => {
  const created = await service.createClaim(customerId, makeRequest());
  const doc = created.uploads[0]!;
  await assert.rejects(service.completeDocument(customerId, created.claimId, doc.documentId), /not been uploaded/);
  const other = await insertCustomer(pool, true);
  await assert.rejects(service.completeDocument(other, created.claimId, doc.documentId), /not found/);
  await assert.rejects(service.presignDocumentUpload(other, created.claimId, doc.documentId), /not found/);
  assert.equal((await service.listClaims(other)).length, 0);
});

test('mismatched object metadata stays pending and unavailable to delivery', async () => {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getDocument } = await import('../src/db/claims-repo');
  const created = await service.createClaim(customerId, makeRequest());
  const documentId = created.uploads[0]!.documentId;
  const doc = (await getDocument(pool, created.claimId, documentId))!;
  const s3 = createTestStorageClient();
  try {
    await s3.send(new PutObjectCommand({ Bucket: loadConfig().STORAGE_BUCKET, Key: doc.storage_key, Body: Buffer.from('wrong'), ContentType: 'text/plain' }));
    await assert.rejects(service.completeDocument(customerId, created.claimId, documentId), /does not match/);
    const claim = await service.getClaim(customerId, created.claimId);
    assert.equal(claim.intakeStatus, 'media_pending');
    assert.equal(claim.documents[0]!.status, 'pending_upload');
    assert.equal(claim.documents[0]!.scanStatus, 'not_scanned');
  } finally { s3.destroy(); }
});


test('rejects stale, unknown and foreign policies without accepting a claim', async () => {
  const request = makeRequest();
  await pool.query('UPDATE policies SET active = false WHERE customer_id = $1', [customerId]);
  await assert.rejects(service.createClaim(customerId, request), /policy is no longer available/);
  const foreign = await insertCustomer(pool);
  await assert.rejects(service.createClaim(foreign, request), /policy is no longer available/);
  await assert.rejects(service.createClaim(customerId, { ...request, policyNumber: 'UNKNOWN' }), /policy is no longer available/);
  const count = await pool.query('SELECT count(*)::int AS c FROM claims');
  assert.equal(count.rows[0].c, 0);
  await pool.query('UPDATE policies SET active = true WHERE customer_id = $1', [customerId]);
  const accepted = await service.createClaim(customerId, request);
  await pool.query('UPDATE policies SET active = false WHERE customer_id = $1', [customerId]);
  const replay = await service.createClaim(customerId, request);
  assert.equal(replay.claimId, accepted.claimId);
  assert.equal(replay.created, false);
});
