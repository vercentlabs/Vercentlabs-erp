BEGIN;
ALTER TABLE tenant.crm_ai_feedback DROP CONSTRAINT IF EXISTS crm_ai_feedback_organization_id_recommendation_id_fkey;
COMMIT;
