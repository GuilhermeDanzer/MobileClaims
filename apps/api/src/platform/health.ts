import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';

import type { AppConfig } from '../config';

/**
 * Dependency health checks. The server stays up even when a dependency is down; the
 * /health endpoint reports the dependency state so an operator can tell the difference
 * between "the API is fine" and "the API is fine but Postgres is down".
 */
export async function checkDatabase(pool: Pool): Promise<'up' | 'down'> {
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

/** The same S3 client used in production, pointed at LocalStack locally (ADR-011). */
export function createStorageClient(config: AppConfig): S3Client {
  return new S3Client({
    region: config.STORAGE_REGION,
    endpoint: config.STORAGE_ENDPOINT,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY,
      secretAccessKey: config.STORAGE_SECRET_KEY,
    },
    // Without this, the SDK adds an x-amz-checksum-crc32 header to presigned PUTs that a
    // plain HTTP client (the mobile uploader) cannot reproduce.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export async function checkStorage(s3: S3Client, bucket: string): Promise<'up' | 'down'> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return 'up';
  } catch {
    return 'down';
  }
}
