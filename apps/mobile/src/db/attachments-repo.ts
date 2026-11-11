import type { SqliteAdapter } from './sqlite-adapter';
import type { Attachment, AttachmentUploadState } from './types';

/** Photographs/documents attached to a draft. Files live in app document storage. */

export interface AddAttachmentInput {
  attachmentId: string;
  draftId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  localUri: string;
}

export async function addAttachment(db: SqliteAdapter, input: AddAttachmentInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO draft_attachments (attachment_id, draft_id, file_name, content_type, size_bytes, sha256, local_uri, upload_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [input.attachmentId, input.draftId, input.fileName, input.contentType, input.sizeBytes, input.sha256, input.localUri],
  );
}

export async function listAttachments(db: SqliteAdapter, draftId: string): Promise<Attachment[]> {
  const rows = await db.getAllAsync<AttachmentRow>(
    `SELECT * FROM draft_attachments WHERE draft_id = ? ORDER BY rowid`,
    [draftId],
  );
  return rows.map(mapAttachment);
}

export async function listIncompleteAttachments(db: SqliteAdapter, draftId: string): Promise<Attachment[]> {
  const rows = await db.getAllAsync<AttachmentRow>(
    `SELECT * FROM draft_attachments WHERE draft_id = ? AND upload_state != 'complete' ORDER BY rowid`,
    [draftId],
  );
  return rows.map(mapAttachment);
}

export async function getAttachment(db: SqliteAdapter, attachmentId: string): Promise<Attachment | null> {
  const row = await db.getFirstAsync<AttachmentRow>(`SELECT * FROM draft_attachments WHERE attachment_id = ?`, [attachmentId]);
  return row ? mapAttachment(row) : null;
}

export async function removeAttachment(db: SqliteAdapter, attachmentId: string): Promise<void> {
  await db.runAsync(`DELETE FROM draft_attachments WHERE attachment_id = ?`, [attachmentId]);
}

export async function setAttachmentDocumentId(db: SqliteAdapter, attachmentId: string, documentId: string): Promise<void> {
  await db.runAsync(`UPDATE draft_attachments SET document_id = ? WHERE attachment_id = ?`, [documentId, attachmentId]);
}

export async function setAttachmentUploadState(db: SqliteAdapter, attachmentId: string, state: AttachmentUploadState): Promise<void> {
  await db.runAsync(`UPDATE draft_attachments SET upload_state = ? WHERE attachment_id = ?`, [state, attachmentId]);
}

export async function incrementAttachmentAttempts(db: SqliteAdapter, attachmentId: string): Promise<void> {
  await db.runAsync(`UPDATE draft_attachments SET upload_attempts = upload_attempts + 1 WHERE attachment_id = ?`, [attachmentId]);
}

/** Crash recovery: an upload that was in flight when the app died goes back to pending. */
export async function resetInterruptedUploads(db: SqliteAdapter): Promise<void> {
  await db.runAsync(`UPDATE draft_attachments SET upload_state = 'pending' WHERE upload_state = 'uploading'`);
}

interface AttachmentRow {
  attachment_id: string;
  draft_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  local_uri: string;
  document_id: string | null;
  upload_state: AttachmentUploadState;
  upload_attempts: number;
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    attachmentId: row.attachment_id,
    draftId: row.draft_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    localUri: row.local_uri,
    documentId: row.document_id,
    uploadState: row.upload_state,
    uploadAttempts: row.upload_attempts,
  };
}
