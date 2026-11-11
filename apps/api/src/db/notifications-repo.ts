import type { Db } from './types';

/** Notification inbox (Level B). Production uses device push (ADR-006). */

export interface NotificationRow {
  notification_id: string;
  claim_id: string | null;
  title: string;
  body: string;
  read_at: Date | null;
  created_at: Date;
}

export async function insertNotification(
  db: Db,
  input: { customerId: string; claimId?: string; title: string; body: string },
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (customer_id, claim_id, title, body) VALUES ($1, $2, $3, $4)`,
    [input.customerId, input.claimId ?? null, input.title, input.body],
  );
}

export async function listNotifications(db: Db, customerId: string): Promise<NotificationRow[]> {
  const result = await db.query<NotificationRow>(
    `SELECT notification_id::text AS notification_id, claim_id::text AS claim_id, title, body, read_at, created_at
     FROM notifications WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [customerId],
  );
  return result.rows;
}
