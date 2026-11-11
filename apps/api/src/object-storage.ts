import {
  CreateBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object-storage boundary (ADR-011). The same S3 client and presigner are used locally
 * (against LocalStack) and in production (against S3); only the endpoint differs.
 */

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
      throw error;
    }
  }
}

export interface PresignPutOptions {
  key: string;
  contentLength: number;
  contentType: string;
  ttlSeconds?: number;
}

/**
 * Presigns a PUT with content-length/content-type signed, so an upload that does not
 * match those values is rejected by the store (ADR — presigned PUT constraints).
 */
export async function presignPut(
  s3: S3Client,
  bucket: string,
  options: PresignPutOptions,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ContentLength: options.contentLength,
    ContentType: options.contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: options.ttlSeconds ?? 300, signableHeaders: new Set(['content-type', 'content-length']) });
}

export interface StoredObject {
  size: number;
  contentType: string | undefined;
}

export async function headObject(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<StoredObject | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: result.ContentLength ?? 0, contentType: result.ContentType };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') return null;
    throw error;
  }
}
