import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
test('fresh migrations serialize across startup, preserve schema, rerun cleanly and roll back failed DDL', async () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://claims:claims@localhost:5432/claims' });
  const schema = `phase6_${Date.now()}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: admin.options.connectionString, options: `-c search_path=${schema}` });
  const temp = await mkdtemp(join(tmpdir(), 'claims-migration-'));
  try {
    const [a, b] = await Promise.all([migrate(pool, migrations), migrate(pool, migrations)]);
    assert.equal(a.length + b.length, 5);
    assert.deepEqual(await migrate(pool, migrations), []);
    assert.equal((await pool.query('SELECT * FROM schema_migrations')).rowCount, 5);
    await pool.query("INSERT INTO idempotency VALUES ('same', gen_random_uuid(), 'hash', 201, '{}', now())");
    await pool.query("INSERT INTO idempotency VALUES ('same', gen_random_uuid(), 'hash', 201, '{}', now())");
    await writeFile(join(temp, '999_invalid.sql'), 'CREATE TABLE rollback_probe (id int); SELECT missing_column;');
    await assert.rejects(migrate(pool, temp), /missing_column/);
    assert.equal((await pool.query("SELECT to_regclass('rollback_probe') AS name")).rows[0].name, null);
    assert.equal((await pool.query("SELECT * FROM schema_migrations WHERE version = '999_invalid.sql'")).rowCount, 0);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await rm(temp, { recursive: true });
  }
});

test('Phase 5 data upgrades preserve idempotency responses and hold only undelivered pending evidence', async () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://claims:claims@localhost:5432/claims' });
  const schema = `phase6_upgrade_${Date.now()}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: admin.options.connectionString, options: `-c search_path=${schema}` });
  const temp = await mkdtemp(join(tmpdir(), 'claims-upgrade-'));
  try {
    for (const name of ['001_initial.sql', '002_reference_sequence.sql', '003_add_policy_number.sql', '004_reconciliation.sql']) {
      await writeFile(join(temp, name), await readFile(join(migrations, name), 'utf8'));
    }
    await migrate(pool, temp);
    const customer = (await pool.query("INSERT INTO customers (email, display_name) VALUES ('upgrade@test', 'Upgrade') RETURNING customer_id")).rows[0].customer_id;
    for (const status of ['received', 'legacy_accepted']) {
      const claim = (await pool.query("INSERT INTO claims (customer_id, client_claim_id, reference, intake_status) VALUES ($1, gen_random_uuid(), $2, $2) RETURNING claim_id", [customer, status])).rows[0].claim_id;
      await pool.query("INSERT INTO claim_documents (claim_id, storage_key, file_name, content_type, size_bytes, sha256) VALUES ($1, 'old/key', 'old.jpg', 'image/jpeg', 1, 'declared')", [claim]);
    }
    await pool.query("INSERT INTO idempotency VALUES ('old-key', $1, 'old-hash', 201, '{\"reference\":\"old\"}', now() + interval '1 day')", [customer]);
    assert.deepEqual(await migrate(pool, migrations), ['005_phase6_safety.sql']);
    const claims = (await pool.query('SELECT reference, intake_status FROM claims ORDER BY reference')).rows;
    assert.deepEqual(claims, [{ reference: 'legacy_accepted', intake_status: 'legacy_accepted' }, { reference: 'received', intake_status: 'media_pending' }]);
    assert.deepEqual((await pool.query('SELECT response_body FROM idempotency')).rows[0].response_body, { reference: 'old' });
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    await rm(temp, { recursive: true });
  }
});
