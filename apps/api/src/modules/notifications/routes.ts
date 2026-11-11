import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import * as notificationsRepo from '../../db/notifications-repo';
import type { Issuer } from '../../platform/auth/issuer';
import { buildAuth } from '../../platform/auth/verify';
import { forbidden } from '../../platform/errors';

/** Customer notification inbox (Level B; production uses device push — ADR-006). */
export function registerNotificationRoutes(app: FastifyInstance, deps: { pool: Pool; issuers: Issuer[] }): void {
  const requireAuth = buildAuth(deps.issuers);

  app.get('/v1/notifications', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth;
    if (auth?.actor !== 'customer' || !auth.customerId) throw forbidden('customer access only');
    return { notifications: await notificationsRepo.listNotifications(deps.pool, auth.customerId) };
  });
}
