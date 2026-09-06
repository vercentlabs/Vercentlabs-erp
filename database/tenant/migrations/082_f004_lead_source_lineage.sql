BEGIN;

-- F004 gap: crm_leads.source_id is a single mutable column, so once a
-- lead's source is corrected/reassigned after creation, the original
-- acquisition channel is lost — contradicting the dossier's explicit
-- "original versus latest source" requirement and CALC-001's "original
-- source is never recalculated away". original_source_id is set once at
-- creation (services/api/src/modules/crm/index.js forces it to mirror
-- source_id on create and refuses to accept it on update) and never
-- changes again, while source_id remains the mutable "current source".
--
-- referrer_name closes the "campaign/referral details" half of the same
-- gap: crm_leads.campaign_id already existed for campaign attribution, but
-- nothing captured who referred a lead when its source channel is
-- 'referral'/'partner'. A free-text field, not a Contact FK, matches the
-- existing shape of comparable lead fields (company_name, job_title) and
-- avoids introducing cross-entity visibility rules for a field that is
-- often filled in before the referrer is a CRM record at all.
ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS original_source_id uuid REFERENCES tenant.crm_lead_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referrer_name text;

-- Best-available backfill for pre-existing rows: true original-source
-- history isn't recoverable after the fact, so the current source is the
-- closest available fact. Every row created after this migration gets a
-- real, permanently-fixed original_source_id from the moment of creation.
UPDATE tenant.crm_leads SET original_source_id = source_id WHERE original_source_id IS NULL AND source_id IS NOT NULL;

COMMIT;
