import type { S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import type { AppConfig } from '../../config';
import { checkDatabase, checkStorage } from '../../platform/health';

export const APP_VERSION = '0.1.0';

/**
 * Public, unauthenticated routes: health and app configuration.
 * /health reports the API process as 'ok' even when a dependency is down — the
 * database/storage fields carry the dependency state instead.
 */
export function registerAppConfigRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; pool: Pool; s3: S3Client },
): void {
  app.get('/health', async () => {
    const [database, storage] = await Promise.all([
      checkDatabase(deps.pool),
      checkStorage(deps.s3, deps.config.STORAGE_BUCKET),
    ]);
    return { status: 'ok', version: APP_VERSION, database, storage };
  });

  app.get('/v1/app-config', async () => ({
    minSupportedVersion: '1.0.0',
    latestVersion: '1.0.0',
    features: { claimSubmission: true, statusTracking: true },
    stormMode: false,
    maintenance: false,
  }));
}
