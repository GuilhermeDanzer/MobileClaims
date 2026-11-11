-- 003_add_policy_number.sql — the legacy createClaim call needs the policy number.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_number TEXT;
