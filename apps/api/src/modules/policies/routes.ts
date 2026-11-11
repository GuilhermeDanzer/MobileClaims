import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import * as policiesRepo from '../../db/policies-repo';
import { forbidden } from '../../platform/errors';
import type { Issuer } from '../../platform/auth/issuer';
import { buildAuth } from '../../platform/auth/verify';

/** Customer-scoped policy list (Level A). Read-only snapshot backing claim creation. */
export function registerPolicyRoutes(app: FastifyInstance, deps: { pool: Pool; issuers: Issuer[] }): void {
  const requireAuth = buildAuth(deps.issuers);

  app.get('/v1/policies', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth;
    if (auth?.actor !== 'customer' || !auth.customerId) throw forbidden('customer access only');

    const rows = await policiesRepo.listPolicies(deps.pool, auth.customerId);
    return {
      policies: rows.map((row) => ({
        policyNumber: row.policy_number,
        product: row.product,
        coverageSummary: row.coverage_summary,
        active: row.active,
      })),
    };
  });
}
