import type { FastifyInstance } from 'fastify';

import type { Issuer } from '../../platform/auth/issuer';
import { buildAuth } from '../../platform/auth/verify';

/** Authenticated route proving which actor the token represents (ADR-015). */
export function registerMeRoutes(app: FastifyInstance, issuers: Issuer[]): void {
  const requireAuth = buildAuth(issuers);

  app.get('/v1/me', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth;
    return { actor: auth?.actor, customerId: auth?.customerId, role: auth?.role };
  });
}
