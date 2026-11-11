import type { Db } from './types';

export interface PolicyRow {
  policy_number: string;
  product: string;
  coverage_summary: string | null;
  active: boolean;
}

/** Customer's cached policy snapshot (Level A — read-only view of the seeded snapshot). */
export async function listPolicies(db: Db, customerId: string): Promise<PolicyRow[]> {
  const result = await db.query<PolicyRow>(
    `SELECT policy_number, product, coverage_summary, active
     FROM policies WHERE customer_id = $1 ORDER BY product, policy_number`,
    [customerId],
  );
  return result.rows;
}
