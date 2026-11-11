-- Preserve existing idempotency entries while making tenant isolation structural.
ALTER TABLE idempotency DROP CONSTRAINT idempotency_pkey;
ALTER TABLE idempotency ADD PRIMARY KEY (customer_id, idempotency_key);
ALTER TABLE claims ADD COLUMN legacy_claim_number TEXT;
ALTER TABLE claims ADD COLUMN reconcile_generation BIGINT NOT NULL DEFAULT 0;
-- Existing incomplete claims were previously eligible for delivery. Do not rewind delivered claims.
UPDATE claims c SET intake_status = 'media_pending'
WHERE intake_status = 'received'
AND EXISTS (SELECT 1 FROM claim_documents d WHERE d.claim_id = c.claim_id AND d.status <> 'complete');
