import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';

import * as policiesRepo from '../src/db/policies-repo';
import { insertCustomer, setupTestDb, truncate } from './helpers';

let pool: Pool;
let customerId: string;

before(async () => {
  pool = await setupTestDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool);
  customerId = await insertCustomer(pool);
});

test('lists the policies for the customer, ordered by product', async () => {
  await pool.query(
    `INSERT INTO policies (customer_id, policy_number, product, coverage_summary, active)
     VALUES ($1, 'POL-AUTO-0002', 'Auto', 'Comprehensive', true),
            ($1, 'POL-HOME-0001', 'Homeowners', NULL, false)`,
    [customerId],
  );

  const rows = await policiesRepo.listPolicies(pool, customerId);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.policy_number),
    ['POL-AUTO-0002', 'POL-HOME-0001'], // 'Auto' sorts before 'Homeowners'
  );
  assert.equal(rows[0]!.active, true);
  assert.equal(rows[1]!.coverage_summary, null);
});

test('returns an empty list for a customer with no policies', async () => {
  const rows = await policiesRepo.listPolicies(pool, customerId);
  assert.deepEqual(rows, []);
});
