-- 001_initial.sql — foundational schema for the Mobile Claims Platform.
-- Mirrors docs/ARCHITECTURE.md §3. Postgres 16 (gen_random_uuid() is built in).

-- Local stand-in for the Cognito subject. customer_id is the tenant key used everywhere.
CREATE TABLE customers (
  customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read-only snapshot of the on-premises policy system (15-min TTL).
CREATE TABLE policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  policy_number TEXT NOT NULL,
  product TEXT NOT NULL,
  coverage_summary TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, policy_number)
);

-- One row per submission. (customer_id, client_claim_id) is the idempotency boundary.
CREATE TABLE claims (
  claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  client_claim_id UUID NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  intake_status TEXT NOT NULL DEFAULT 'received',
  incident_description TEXT,
  incident_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, client_claim_id)
);

-- Metadata for each uploaded photograph/document.
CREATE TABLE claim_documents (
  document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_upload',
  scan_status TEXT NOT NULL DEFAULT 'not_scanned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only timeline. Unknown legacy statuses are stored verbatim.
CREATE TABLE claim_status_events (
  event_id BIGSERIAL PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'platform',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_claim_status_events_claim ON claim_status_events (claim_id, at);

-- Durable events written in the same transaction as the claim (ADR-005).
CREATE TABLE outbox_events (
  event_id BIGSERIAL PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- Local message queue (Level B). Reproduces SQS semantics, not throughput (ADR-014).
CREATE TABLE queue_messages (
  message_id BIGSERIAL PRIMARY KEY,
  queue TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  visible_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_queue_visible ON queue_messages (queue, visible_at);

CREATE TABLE queue_dead_letters (
  dead_letter_id BIGSERIAL PRIMARY KEY,
  queue TEXT NOT NULL,
  payload JSONB NOT NULL,
  last_error TEXT,
  attempt_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notification inbox (Level B). Production uses device push (ADR-006).
CREATE TABLE notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  claim_id UUID REFERENCES claims(claim_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency-Key support: replay a POST and get the same response.
CREATE TABLE idempotency (
  idempotency_key TEXT PRIMARY KEY,
  customer_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INT NOT NULL,
  response_body JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Append-only audit trail.
CREATE TABLE audit_events (
  audit_id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  correlation_id TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Runtime flags for dev fault injection (registered only in local environments).
CREATE TABLE runtime_flags (
  flag TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
