BEGIN;
ALTER TABLE tenant.crm_ai_feedback ADD COLUMN IF NOT EXISTS draft_id uuid;
COMMIT;
