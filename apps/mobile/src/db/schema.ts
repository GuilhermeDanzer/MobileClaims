import type { SqliteAdapter } from './sqlite-adapter';

/**
 * Versioned migrations. `user_version` is the source of truth (the expo-sqlite convention).
 * Each new release appends a migration string; existing devices are upgraded in place and
 * the same code path runs in tests via the node:sqlite adapter.
 */
const MIGRATIONS: string[] = [
  // v1 — drafts, attachments, the submission queue, and the server cache.
  `
  CREATE TABLE drafts (
    draft_id TEXT PRIMARY KEY,
    client_claim_id TEXT NOT NULL UNIQUE,
    policy_number TEXT NOT NULL,
    incident_description TEXT NOT NULL,
    incident_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE draft_attachments (
    attachment_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    document_id TEXT,
    upload_state TEXT NOT NULL DEFAULT 'pending',
    upload_attempts INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE submission_queue (
    draft_id TEXT PRIMARY KEY REFERENCES drafts(draft_id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    claim_id TEXT,
    reference TEXT,
    accepted_at TEXT
  );

  CREATE TABLE claims_cache (
    claim_id TEXT PRIMARY KEY,
    reference TEXT NOT NULL,
    policy_number TEXT,
    intake_status TEXT NOT NULL,
    latest_status TEXT,
    incident_description TEXT,
    incident_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cached_at TEXT NOT NULL
  );

  CREATE TABLE claim_documents_cache (
    document_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    scan_status TEXT NOT NULL
  );

  CREATE TABLE status_events_cache (
    claim_id TEXT NOT NULL,
    at TEXT NOT NULL,
    status TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (claim_id, at, status, label)
  );
  `,
  // v2 — response snapshots, isolated by the owning database file.
  `CREATE TABLE read_snapshots (
    resource TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`,
];

/** Applies any pending migrations. Safe to call on every cold start. */
export async function initDatabase(db: SqliteAdapter): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version++) {
    const migration = MIGRATIONS[version]!;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
