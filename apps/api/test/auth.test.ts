import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLocalIssuer } from '../src/platform/auth/issuer';
import { verifyToken } from '../src/platform/auth/verify';

test('a customer token verifies as a customer with the subject as customerId', async () => {
  const issuer = await createLocalIssuer('customer', 'http://localhost:3000/customer', 'mobile-app');
  const token = await issuer.issue({ sub: 'customer-123' });

  const ctx = await verifyToken(token, [issuer]);
  assert.deepEqual(ctx, { actor: 'customer', customerId: 'customer-123' });
});

test('an employee token verifies with the role claim', async () => {
  const issuer = await createLocalIssuer('employee', 'http://localhost:3000/employee', 'internal-tools');
  const token = await issuer.issue({ sub: 'emp-1', role: 'adjuster' });

  const ctx = await verifyToken(token, [issuer]);
  assert.deepEqual(ctx, { actor: 'employee', role: 'adjuster' });
});

test('a token issued for the customer audience is rejected by the employee verifier', async () => {
  const customer = await createLocalIssuer('customer', 'http://localhost:3000/customer', 'mobile-app');
  const employee = await createLocalIssuer('employee', 'http://localhost:3000/employee', 'internal-tools');
  const token = await customer.issue({ sub: 'customer-123' });

  await assert.rejects(() => verifyToken(token, [employee]));
});

test('expired, missing-subject and tampered tokens fail verification', async () => {
  const issuer = await createLocalIssuer('customer', 'test:issuer', 'mobile-app');
  await assert.rejects(verifyToken(await issuer.issue({ sub: 'c' }, '-1s'), [issuer]));
  await assert.rejects(verifyToken(await issuer.issue({}), [issuer]));
  const token = await issuer.issue({ sub: 'c' });
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'other', exp: 9999999999 })).toString('base64url');
  await assert.rejects(verifyToken(parts.join('.'), [issuer]));
});

test('a correctly signed token without expiration is rejected', async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey);
  const issuer = { actor: 'customer' as const, issuer: 'test:no-exp', audience: 'mobile-app',
    jwks: async () => ({ keys: [{ ...key, alg: 'RS256', kid: 'test' }] }),
    issue: async () => '' };
  const token = await new SignJWT({ sub: 'customer' }).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer.issuer).setAudience(issuer.audience).sign(privateKey);
  await assert.rejects(verifyToken(token, [issuer]));
});
