import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZodError } from 'zod';

import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig, type AppConfig } from './config';
import { createPool } from './db/pool';
import { migrate } from './db/migrate';
import { seedLocalDevData } from './db/seed';
import { loggerOptions } from './logger';
import { registerAppConfigRoutes } from './modules/app-config/routes';
import { registerClaimsRoutes } from './modules/claims/routes';
import { createClaimsService } from './modules/claims/service';
import { registerDevRoutes } from './modules/dev/routes';
import { registerMeRoutes } from './modules/me/routes';
import { registerNotificationRoutes } from './modules/notifications/routes';
import { registerPolicyRoutes } from './modules/policies/routes';
import { ApiError } from './platform/errors';
import { createStorageClient } from './platform/health';
import { createLocalIssuer } from './platform/auth/issuer';
import { ensureBucket } from './object-storage';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'db', 'migrations');

export async function buildServer(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  if (config.APP_ENV === 'production' || config.AUTH_MODE !== 'dev') {
    throw new Error('Real identity federation is not implemented; local issuers are disabled in production/real mode');
  }
  const app = Fastify({ logger: loggerOptions(config.LOG_LEVEL) });

  const pool = createPool(config.DATABASE_URL);
  const s3 = createStorageClient(config);

  // Best-effort migration at startup. A down database is reported by /health, not a crash.
  try {
    const applied = await migrate(pool, MIGRATIONS_DIR);
    app.log.info({ applied }, 'database migrations applied');
  } catch (error) {
    app.log.warn({ err: error }, 'migration failed — /health will report database: down');
  }

  if (config.APP_ENV === 'local') {
    try {
      await seedLocalDevData(pool);
      app.log.info('local dev data seeded');
    } catch (error) {
      app.log.warn({ err: error }, 'local dev seed failed');
    }
  }

  // Best-effort bucket creation (LocalStack locally, S3 in production). A down store is
  // reported by /health rather than crashing the API.
  try {
    await ensureBucket(s3, config.STORAGE_BUCKET);
    app.log.info({ bucket: config.STORAGE_BUCKET }, 'object storage ready');
  } catch (error) {
    app.log.warn({ err: error }, 'object storage not available');
  }

  // Two issuers with distinct audiences; customer and employee tokens are never interchangeable.
  const customerIssuer = await createLocalIssuer('customer', `${baseUrl(config)}/customer`, 'mobile-app');
  const employeeIssuer = await createLocalIssuer('employee', `${baseUrl(config)}/employee`, 'internal-tools');

  // Correlation id: reuse an incoming header, otherwise mint one.
  app.decorateRequest('auth', null);
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', async (request) => {
    request.correlationId = (request.headers['x-correlation-id'] as string) ?? randomUUID();
  });

  // Single, consistent error envelope for every failure path.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError || (error as { statusCode?: number })?.statusCode === 400) {
      return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request', correlationId: request.correlationId } });
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, correlationId: request.correlationId },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', correlationId: request.correlationId },
    });
  });

  registerAppConfigRoutes(app, { config, pool, s3 });
  registerMeRoutes(app, [customerIssuer, employeeIssuer]);
  const claimsService = createClaimsService({ pool, s3, bucket: config.STORAGE_BUCKET });
  registerClaimsRoutes(app, { service: claimsService, pool, issuers: [customerIssuer, employeeIssuer] });
  registerNotificationRoutes(app, { pool, issuers: [customerIssuer, employeeIssuer] });
  registerPolicyRoutes(app, { pool, issuers: [customerIssuer, employeeIssuer] });
  registerDevRoutes(app, { config, customerIssuer, employeeIssuer, pool });

  app.addHook('onClose', async () => { await pool.end(); s3.destroy(); });
  return app;
}

function baseUrl(config: AppConfig): string {
  return `http://localhost:${config.PORT}`;
}
