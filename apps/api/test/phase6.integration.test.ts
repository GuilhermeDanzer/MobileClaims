import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { createLocalIssuer } from '../src/platform/auth/issuer';
import { registerClaimsRoutes } from '../src/modules/claims/routes';
import { createClaimsService } from '../src/modules/claims/service';
import { ApiError } from '../src/platform/errors';
import { buildServer } from '../src/server';
import { loadConfig } from '../src/config';
import { createTestStorageClient, insertCustomer, setupTestDb, truncate } from './helpers';

let pool: Pool;
const issuer = await createLocalIssuer('customer', 'test:customer', 'mobile-app');
const employee = await createLocalIssuer('employee', 'test:employee', 'internal-tools');
const s3 = createTestStorageClient();
const app = Fastify();
before(async () => {
  pool = await setupTestDb();
  registerClaimsRoutes(app, { pool, issuers: [issuer, employee], service: createClaimsService({ pool, s3, bucket: loadConfig().STORAGE_BUCKET }) });
  app.decorateRequest('auth', null);
  app.setErrorHandler((error, _req, reply) => {
    const status = error instanceof ApiError ? error.statusCode : 500;
    return reply.code(status).send({ error: String(error) });
  });
  await app.ready();
});
beforeEach(async () => { await truncate(pool); });
after(async () => { await app.close(); await pool.end(); s3.destroy(); });
const payload = () => ({ clientClaimId: randomUUID(), policyNumber: 'POL-HOME-0001', incidentDescription: 'Test', incidentDate: '2026-11-03', documents: [] });
async function auth(customerId: string, key = 'same-key') {
  return { authorization: `Bearer ${await issuer.issue({ sub: customerId })}`, 'idempotency-key': key };
}

test('idempotency keys are tenant-scoped and changed bodies conflict', async () => {
  const a = await insertCustomer(pool, true);
  const b = await insertCustomer(pool, true);
  const body = payload();
  const headers = await auth(a);
  const first = await app.inject({ method: 'POST', url: '/v1/claims', headers, payload: body });
  assert.equal(first.statusCode, 201);
  const replay = await app.inject({ method: 'POST', url: '/v1/claims', headers, payload: body });
  assert.deepEqual(replay.json(), first.json());
  const other = await app.inject({ method: 'POST', url: '/v1/claims', headers: await auth(b), payload: body });
  assert.equal(other.statusCode, 201);
  assert.notEqual(other.json().claimId, first.json().claimId);
  const conflict = await app.inject({ method: 'POST', url: '/v1/claims', headers, payload: { ...body, incidentDescription: 'Changed' } });
  assert.equal(conflict.statusCode, 409);
  const denied = await app.inject({ method: 'GET', url: `/v1/claims/${first.json().claimId}`, headers: await auth(b) });
  assert.equal(denied.statusCode, 404);
  const employeeDenied = await app.inject({ method: 'GET', url: '/v1/claims', headers: { authorization: `Bearer ${await employee.issue({ sub: 'e', role: 'adjuster' })}` } });
  assert.equal(employeeDenied.statusCode, 403);
});

test('20 concurrent keyed submissions share one response without pool starvation', async () => {
  const customer = await insertCustomer(pool, true);
  const headers = await auth(customer);
  const body = payload();
  const responses = await Promise.all(Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: '/v1/claims', headers, payload: body })));
  assert.ok(responses.every((r) => r.statusCode === 201));
  assert.equal(new Set(responses.map((r) => r.json().claimId)).size, 1);
  assert.equal((await pool.query('SELECT * FROM outbox_events')).rowCount, 1);
});

test('expired idempotency entry can be safely reused', async () => {
  const customer = await insertCustomer(pool, true);
  const headers = await auth(customer);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/claims', headers, payload: payload() })).statusCode, 201);
  await pool.query("UPDATE idempotency SET expires_at = now() - interval '1 second'");
  assert.equal((await app.inject({ method: 'POST', url: '/v1/claims', headers, payload: payload() })).statusCode, 201);
});

test('server fails closed for unsupported identity modes and returns 400 for malformed claims', async () => {
  await assert.rejects(buildServer(loadConfig({ APP_ENV: 'production' })), /disabled/);
  await assert.rejects(buildServer(loadConfig({ AUTH_MODE: 'real' })), /disabled/);
  const dbUrl = pool.options.connectionString!;
  const server = await buildServer(loadConfig({ APP_ENV: 'local', DATABASE_URL: dbUrl, LOG_LEVEL: 'silent' }));
  try {
    const token = (await server.inject({ method: 'POST', url: '/dev/auth/customer', payload: {} })).json().accessToken;
    const bad = await server.inject({ method: 'POST', url: '/v1/claims', headers: { authorization: `Bearer ${token}` }, payload: {} });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error.code, 'INVALID_REQUEST');
    assert.equal((await server.inject({ url: '/v1/claims/not-a-uuid', headers: { authorization: `Bearer ${token}` } })).statusCode, 400);
    assert.equal((await server.inject('/health')).statusCode, 200);
  } finally { await server.close(); }
});
