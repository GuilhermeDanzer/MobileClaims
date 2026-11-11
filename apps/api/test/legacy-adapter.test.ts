import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpLegacyClaimsGateway } from '../src/integrations/legacy/http-gateway';

test('legacy HTTP adapter refuses malformed success responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
  const gateway = new HttpLegacyClaimsGateway('http://unused.test');
  await assert.rejects(gateway.createClaim({ reference: 'NW-test', policyNumber: 'POL', documentNames: [] }));
  await assert.rejects(gateway.getStatus('NW-test'));
});
