import { createHash } from 'node:crypto';

import { createClaimRequestSchema } from '@northwind/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import * as idempotencyRepo from '../../db/idempotency-repo';
import { ApiError, forbidden } from '../../platform/errors';
import type { Issuer } from '../../platform/auth/issuer';
import { buildAuth } from '../../platform/auth/verify';
import { increment } from '../../platform/metrics';
import type { ClaimsService } from './service';

/** HTTP surface for the claims domain. Every route is customer-scoped. */
export function registerClaimsRoutes(
  app: FastifyInstance,
  deps: { service: ClaimsService; pool: Pool; issuers: Issuer[] },
): void {
  const requireAuth = buildAuth(deps.issuers);
  const requireCustomer = (request: { auth: { actor: string; customerId?: string } | null }): string => {
    const auth = request.auth;
    if (auth?.actor !== 'customer' || !auth.customerId) throw forbidden('customer access only');
    return auth.customerId;
  };

  app.post('/v1/claims', { preHandler: requireAuth }, async (request, reply) => {
    const customerId = requireCustomer(request);
    const input = createClaimRequestSchema.parse(request.body);

    // Generic Idempotency-Key replay (secondary to clientClaimId, which is authoritative).
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const lock = idempotencyKey ? await deps.pool.connect() : null;
    try {
      if (lock) {
        await lock.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [JSON.stringify([customerId, idempotencyKey])]);
      }
      if (idempotencyKey) {
        const existing = await idempotencyRepo.getIdempotency(lock ?? deps.pool, idempotencyKey, customerId);
        if (existing) {
          if (existing.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used for another request');
          return reply.status(existing.response_status).send(existing.response_body);
        }
      }

      const result = await deps.service.createClaim(customerId, input, lock ?? undefined);
      increment(result.created ? 'claims.created' : 'claims.replayed');
      const status = result.created ? 201 : 200;
      const body = {
        claimId: result.claimId,
        reference: result.reference,
        intakeStatus: result.intakeStatus,
        createdAt: result.createdAt,
        uploads: result.uploads,
      };

      if (idempotencyKey) {
        await idempotencyRepo.setIdempotency(lock ?? deps.pool, {
          key: idempotencyKey,
          customerId,
          requestHash,
          responseStatus: status,
          responseBody: body,
        });
      }

      return reply.status(status).send(body);
    } finally {
      if (lock) {
        try { await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [JSON.stringify([customerId, idempotencyKey])]); } finally { lock.release(); }
      }
    }
  });

  app.get('/v1/claims', { preHandler: requireAuth }, async (request) => {
    const customerId = requireCustomer(request);
    return { claims: await deps.service.listClaims(customerId) };
  });

  app.get('/v1/claims/:claimId', { preHandler: requireAuth }, async (request) => {
    const customerId = requireCustomer(request);
    const { claimId } = z.object({ claimId: z.string().uuid() }).parse(request.params);
    return await deps.service.getClaim(customerId, claimId);
  });

  app.get('/v1/claims/:claimId/events', { preHandler: requireAuth }, async (request) => {
    const customerId = requireCustomer(request);
    const { claimId } = z.object({ claimId: z.string().uuid() }).parse(request.params);
    return { events: await deps.service.getStatusEvents(customerId, claimId) };
  });

  app.post('/v1/claims/:claimId/documents/:documentId/complete', { preHandler: requireAuth }, async (request) => {
    const customerId = requireCustomer(request);
    const { claimId, documentId } = z.object({ claimId: z.string().uuid(), documentId: z.string().uuid() }).parse(request.params);
    return await deps.service.completeDocument(customerId, claimId, documentId);
  });

  app.post('/v1/claims/:claimId/documents/:documentId/upload-url', { preHandler: requireAuth }, async (request) => {
    const customerId = requireCustomer(request);
    const { claimId, documentId } = z.object({ claimId: z.string().uuid(), documentId: z.string().uuid() }).parse(request.params);
    return await deps.service.presignDocumentUpload(customerId, claimId, documentId);
  });
}
