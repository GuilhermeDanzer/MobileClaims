/** A local file to PUT to a presigned URL. */
export interface UploadInput {
  localUri: string;
  contentType: string;
}

/** The machine-readable failure categories the API client produces. */
export type SyncErrorKind = 'auth' | 'permanent' | 'transient' | 'unknown';
