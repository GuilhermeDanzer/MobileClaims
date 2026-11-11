import type { SqliteAdapter } from './sqlite-adapter';
import type { Draft } from './types';

/**
 * Draft CRUD. A draft is created with its `clientClaimId` and a matching queue row in one
 * transaction, so the idempotency key is durable from the moment the customer first saves.
 */

export interface CreateDraftInput {
  draftId: string;
  clientClaimId: string;
  policyNumber: string;
  incidentDescription: string;
  incidentDate: string;
  now: string;
}

export async function createDraft(db: SqliteAdapter, input: CreateDraftInput): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO drafts (draft_id, client_claim_id, policy_number, incident_description, incident_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.draftId, input.clientClaimId, input.policyNumber, input.incidentDescription, input.incidentDate, input.now, input.now],
    );
    await db.runAsync(
      `INSERT INTO submission_queue (draft_id, state, next_attempt_at) VALUES (?, 'draft', ?)`,
      [input.draftId, input.now],
    );
  });
}

export async function getDraft(db: SqliteAdapter, draftId: string): Promise<Draft | null> {
  const row = await db.getFirstAsync<DraftRow>(`SELECT * FROM drafts WHERE draft_id = ?`, [draftId]);
  return row ? mapDraft(row) : null;
}

export async function listDrafts(db: SqliteAdapter): Promise<Draft[]> {
  const rows = await db.getAllAsync<DraftRow>(`SELECT * FROM drafts ORDER BY updated_at DESC`);
  return rows.map(mapDraft);
}

export async function updateDraft(
  db: SqliteAdapter,
  draftId: string,
  fields: { policyNumber?: string; incidentDescription?: string; incidentDate?: string; now: string },
): Promise<void> {
  const current = await getDraft(db, draftId);
  if (!current) return;
  await db.runAsync(
    `UPDATE drafts
     SET policy_number = ?, incident_description = ?, incident_date = ?, updated_at = ?
     WHERE draft_id = ?`,
    [
      fields.policyNumber ?? current.policyNumber,
      fields.incidentDescription ?? current.incidentDescription,
      fields.incidentDate ?? current.incidentDate,
      fields.now,
      draftId,
    ],
  );
}

export async function deleteDraft(db: SqliteAdapter, draftId: string): Promise<void> {
  await db.runAsync(`DELETE FROM drafts WHERE draft_id = ?`, [draftId]);
}

interface DraftRow {
  draft_id: string;
  client_claim_id: string;
  policy_number: string;
  incident_description: string;
  incident_date: string;
  created_at: string;
  updated_at: string;
}

function mapDraft(row: DraftRow): Draft {
  return {
    draftId: row.draft_id,
    clientClaimId: row.client_claim_id,
    policyNumber: row.policy_number,
    incidentDescription: row.incident_description,
    incidentDate: row.incident_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
