import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import * as flagsRepo from '../../db/flags-repo';
import * as notificationsRepo from '../../db/notifications-repo';
import * as queueRepo from '../../db/queue-repo';
import type { Issuer } from '../../platform/auth/issuer';
import { snapshot } from '../../platform/metrics';

const customerLoginSchema = z.object({ email: z.string().email().optional() });
const flagSchema = z.object({ flag: z.string().min(1), value: z.unknown() });

/**
 * Dev-only routes (Level B). Registered only when APP_ENV=local and AUTH_MODE=dev, per
 * ADR-015. Includes the local identity issuers, fault flags, and a metrics endpoint.
 */
export function registerDevRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; customerIssuer: Issuer; employeeIssuer: Issuer; pool: Pool },
): void {
  if (deps.config.APP_ENV !== 'local' || deps.config.AUTH_MODE !== 'dev') {
    return;
  }

  app.post('/dev/auth/customer', async (request) => {
    const { email } = customerLoginSchema.parse(request.body ?? {});
    const token = await deps.customerIssuer.issue({
      sub: '00000000-0000-0000-0000-000000000001',
      email: email ?? 'customer@example.com',
    });
    return { accessToken: token, tokenType: 'Bearer' };
  });

  app.post('/dev/auth/employee', async () => {
    const token = await deps.employeeIssuer.issue({
      sub: 'employee-1',
      role: 'adjuster',
      email: 'adjuster@northwind.example',
    });
    return { accessToken: token, tokenType: 'Bearer' };
  });

  app.get('/dev/flags', async () => ({ flags: await flagsRepo.listFlags(deps.pool) }));

  app.post('/dev/flags', async (request) => {
    const { flag, value } = flagSchema.parse(request.body);
    await flagsRepo.setFlag(deps.pool, flag, value);
    return { flag, value };
  });

  app.get('/dev/metrics', async () => {
    const queueDepth = Number((await deps.pool.query('SELECT count(*)::int AS c FROM queue_messages')).rows[0]!.c);
    const deadLetters = Number((await deps.pool.query('SELECT count(*)::int AS c FROM queue_dead_letters')).rows[0]!.c);
    const breakerState = await flagsRepo.getFlag(deps.pool, 'worker.breakerState', 'unknown');

    const alerts: string[] = [];
    if (deadLetters > 0) alerts.push('dead-letter queue is non-empty');
    if (breakerState === 'open') alerts.push('legacy circuit breaker is open');

    return { counters: snapshot(), queueDepth, deadLetters, breakerState, alerts };
  });

  app.post('/dev/notifications', async () => {
    await notificationsRepo.insertNotification(deps.pool, {
      customerId: '00000000-0000-0000-0000-000000000001',
      title: 'Test notification',
      body: 'Triggered from /dev/notifications',
    });
    return { ok: true };
  });

  app.post('/dev/queue/redrive', async () => {
    const redriven = await queueRepo.requeueDeadLetters(deps.pool, 'claims');
    return { redriven };
  });
}
