import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildServer as buildStub } from '../../onprem-stub/src/server';
import { buildServer } from '../src/server';
import { loadConfig } from '../src/config';
import { HttpLegacyClaimsGateway } from '../src/integrations/legacy/http-gateway';
import { CircuitBreaker } from '../src/platform/circuit-breaker';
import { deliverClaim } from '../src/worker/deliver';
import { reconcileDueClaims } from '../src/worker/reconcile';
import { getUnpublishedOutboxEvents, markOutboxPublished } from '../src/db/outbox-repo';
import { enqueue, claimMessage, completeMessage } from '../src/db/queue-repo';
import { setupTestDb, truncate } from './helpers';

test('local HTTP smoke: auth, policies, accepted claim, S3 PUT, queue delivery, stub dedupe and status', async () => {
  const pool = await setupTestDb();
  await truncate(pool);
  const app = await buildServer(loadConfig({ APP_ENV: 'local', DATABASE_URL: pool.options.connectionString, LOG_LEVEL: 'silent' }));
  const stub = buildStub();
  try {
    await stub.listen({ port: 0, host: '127.0.0.1' });
    const address = stub.server.address();
    assert.ok(address && typeof address !== 'string');
    const gateway = new HttpLegacyClaimsGateway(`http://127.0.0.1:${address.port}`);
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
    const health = (await app.inject('/health')).json();
    assert.equal(health.database, 'up'); assert.equal(health.storage, 'up');
    const token = (await app.inject({ method: 'POST', url: '/dev/auth/customer', payload: {} })).json().accessToken;
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await app.inject({ url: '/v1/me', headers })).json().actor, 'customer');
    assert.equal((await app.inject({ url: '/v1/policies', headers })).json().policies.length, 2);
    const bytes = Buffer.from('smoke-evidence');
    const created = await app.inject({ method: 'POST', url: '/v1/claims', headers, payload: {
      clientClaimId: randomUUID(), policyNumber: 'POL-HOME-0001', incidentDescription: 'Smoke', incidentDate: '2026-11-03',
      documents: [{ fileName: 'smoke.jpg', contentType: 'image/jpeg', contentLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
    } });
    assert.equal(created.statusCode, 201);
    const body = created.json();
    assert.equal(body.intakeStatus, 'media_pending');
    assert.equal((await getUnpublishedOutboxEvents(pool)).length, 0);
    const upload = body.uploads[0];
    assert.ok((await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes })).ok);
    assert.equal((await app.inject({ method: 'POST', url: `/v1/claims/${body.claimId}/documents/${upload.documentId}/complete`, headers })).statusCode, 200);
    const events = await getUnpublishedOutboxEvents(pool);
    for (const event of events) await enqueue(pool, { queue: 'claims', payload: event.payload });
    await markOutboxPublished(pool, events.map((e) => e.event_id));
    const message = (await claimMessage(pool, 'claims', 30))!;
    await deliverClaim(pool, gateway, breaker, message.payload as { claimId: string; customerId: string; reference: string });
    await completeMessage(pool, message.message_id, message.attempt_count);
    const external = { reference: body.reference, policyNumber: 'POL-HOME-0001', documentNames: [] };
    assert.equal((await gateway.createClaim(external)).legacyClaimNumber, (await gateway.createClaim(external)).legacyClaimNumber);
    await reconcileDueClaims(pool, gateway, breaker, { pollIntervalSeconds: 0 });
    const timeline = (await app.inject({ url: `/v1/claims/${body.claimId}/events`, headers })).json().events;
    assert.ok(timeline.some((e: { status: string }) => e.status === 'under_review'));
    const claim = (await app.inject({ url: `/v1/claims/${body.claimId}`, headers })).json();
    assert.equal(claim.intakeStatus, 'legacy_accepted');
    assert.equal(claim.documents[0].scanStatus, 'not_scanned');
  } finally { await app.close(); await stub.close(); await pool.end(); }
});
