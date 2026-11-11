import { randomBytes } from 'node:crypto';

import Fastify, { type FastifyReply } from 'fastify';
import { z } from 'zod';

import { getFaultState, setFaultState, type FaultState } from './faults';

const faultSchema = z.object({
  mode: z.enum(['ok', 'down', 'slow', 'duplicate', 'reject', 'error500']).optional(),
  latencyMs: z.number().int().min(0).max(120_000).optional(),
});

const createClaimSchema = z.object({
  reference: z.string(),
  policyNumber: z.string(),
  incidentDescription: z.string().optional(),
  documents: z.array(z.object({ name: z.string() })).optional(),
});

const statusSetSchema = z.object({ reference: z.string().min(1), status: z.string().min(1) });

/**
 * Stand-in for the on-premises policy and claims systems (Level B — simulated).
 * The platform's HttpLegacyClaimsGateway calls this over HTTP exactly as it would call
 * the real system; only the far end is a stub. Fault controls live under /dev/faults.
 */
export function buildServer() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok', service: 'onprem-stub' }));

  app.get('/dev/faults', async () => getFaultState());
  app.post('/dev/faults', async (request) => setFaultState(faultSchema.parse(request.body ?? {})));

  // Seeded policy snapshot (read-only source of truth for policies is the real system).
  app.get('/policies', async (request) => {
    const { customerId } = request.query as { customerId?: string };
    const policies = [
      {
        policyNumber: 'POL-HOME-0001',
        product: 'Homeowners',
        coverageSummary: 'Dwelling + contents, $500k',
        active: true,
      },
      {
        policyNumber: 'POL-AUTO-0002',
        product: 'Auto',
        coverageSummary: 'Comprehensive, two vehicles',
        active: true,
      },
    ];
    return { customerId: customerId ?? null, policies };
  });

  // Legacy claim creation. Deduplicates on the platform reference unless the
  // 'duplicate' fault is active, which simulates a legacy system that cannot dedupe.
  const seenReferences = new Map<string, string>();

  app.post('/claims', async (request, reply) => {
    if (await applyFault(reply)) return;

    const body = createClaimSchema.parse(request.body);
    const dedupe = getFaultState().mode !== 'duplicate';

    let legacyClaimNumber = seenReferences.get(body.reference);
    if (!legacyClaimNumber || !dedupe) {
      legacyClaimNumber = `LEG-${Date.now()}-${randomBytes(3).toString('hex')}`;
      seenReferences.set(body.reference, legacyClaimNumber);
    }

    return reply.code(201).send({
      legacyClaimNumber,
      reference: body.reference,
      receivedAt: new Date().toISOString(),
    });
  });

  // Legacy status query. Downstream status is configurable per reference (default under_review)
  // so reconciliation transitions can be exercised end-to-end.
  const statusByReference = new Map<string, string>();

  app.post('/dev/status', async (request) => {
    const { reference, status } = statusSetSchema.parse(request.body);
    statusByReference.set(reference, status);
    return { reference, status };
  });

  app.get('/claims/:reference/status', async (request, reply) => {
    if (await applyFault(reply)) return;
    const { reference } = request.params as { reference: string };
    return {
      reference,
      status: statusByReference.get(reference) ?? 'under_review',
      updatedAt: new Date().toISOString(),
    };
  });

  return app;
}

async function applyFault(reply: FastifyReply): Promise<boolean> {
  const fault: FaultState = getFaultState();
  if (fault.latencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, fault.latencyMs));
  }
  switch (fault.mode) {
    case 'down':
      reply.code(503).send({ error: 'claims system unavailable' });
      return true;
    case 'reject':
      reply.code(422).send({ error: 'claim rejected by legacy system' });
      return true;
    case 'error500':
      reply.code(500).send({ error: 'legacy internal error' });
      return true;
    default:
      return false;
  }
}
