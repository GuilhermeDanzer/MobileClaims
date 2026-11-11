-- 004_reconciliation.sql — tracks downstream legacy status and polling schedule per claim.
-- legacy_status: last known adjudication status (null until first successful poll).
-- reconcile_at: next eligible poll time; NULL = not eligible (never delivered, or terminal).
-- reconcile_attempts: consecutive poll failures, for bounded backoff.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS legacy_status TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS reconcile_at TIMESTAMPTZ;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS reconcile_attempts INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_claims_reconcile
  ON claims (intake_status, reconcile_at)
  WHERE reconcile_at IS NOT NULL;
