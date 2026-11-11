import type { Pool } from 'pg';

/** Local dev seed data, applied only when APP_ENV=local. Never runs in production. */
const DEV_CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

export async function seedLocalDevData(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO customers (customer_id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_id) DO NOTHING`,
    [DEV_CUSTOMER_ID, 'customer@example.com', 'Local Dev Customer'],
  );
  await pool.query(
    `INSERT INTO policies (customer_id, policy_number, product, coverage_summary)
     SELECT $1, p.policy_number, p.product, p.coverage_summary
     FROM (VALUES ('POL-HOME-0001', 'Homeowners', 'Dwelling + contents, $500k'),
                  ('POL-AUTO-0002', 'Auto', 'Comprehensive, two vehicles')) AS p(policy_number, product, coverage_summary)
     ON CONFLICT (customer_id, policy_number) DO NOTHING`,
    [DEV_CUSTOMER_ID],
  );
}
