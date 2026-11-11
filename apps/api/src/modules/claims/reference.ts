import type { Db } from '../../db/types';

/** Human-readable claim reference backed by a monotonic sequence (assumption A11). */
export function formatReference(sequence: number, now = new Date()): string {
  const year = now.getUTCFullYear();
  return `NW-${year}-${String(sequence).padStart(6, '0')}`;
}

export async function nextReference(db: Db): Promise<string> {
  const result = await db.query<{ nextval: string }>(`SELECT nextval('claim_reference_seq') AS nextval`);
  return formatReference(Number(result.rows[0]!.nextval));
}
