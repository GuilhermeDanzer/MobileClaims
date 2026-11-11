import { File, UploadType } from 'expo-file-system';

import type { UploadInput } from './types';

export type { UploadInput };

/**
 * Uploads a local file to a presigned URL with progress. Throws when the store does not
 * acknowledge with a 2xx, so the caller can retry. The presigned URL already constrains
 * length and content type (ADR — presigned PUT constraints).
 */
export async function uploadToPresignedUrl(
  input: UploadInput,
  url: string,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Promise<void> {
  const file = new File(input.localUri);
  if (!file.exists) {
    throw Object.assign(
      new Error('A saved attachment is missing from this device. Contact support with your claim reference.'),
      { kind: 'permanent' },
    );
  }
  const controller = new AbortController();
  const abortStalledUpload = () => controller.abort();
  let idleTimer = setTimeout(abortStalledUpload, 60_000);
  let lastSent = 0;
  try {
    const result = await file.upload(url, {
      httpMethod: 'PUT',
      headers: { 'content-type': input.contentType },
      uploadType: UploadType.BINARY_CONTENT,
      signal: controller.signal,
      // SDK runtimes may report bigint counters. Supported files are at most 10 MB.
      onProgress: (progress) => {
        const sent = Number(progress.bytesSent);
        const total = Number(progress.totalBytes);
        if (sent > lastSent) {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(abortStalledUpload, 60_000);
          lastSent = sent;
        }
        onProgress?.(sent, total);
      },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error('The upload was not confirmed');
    }
  } catch {
    throw new Error('Could not send this attachment. It is saved on this device and will retry with a fresh upload link.');
  } finally {
    clearTimeout(idleTimer);
  }
}
