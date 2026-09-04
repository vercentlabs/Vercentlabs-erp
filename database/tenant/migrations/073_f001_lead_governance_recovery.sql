BEGIN;

ALTER TABLE tenant.crm_lead_saved_views
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS team_id uuid,
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE tenant.crm_lead_saved_views
SET visibility='private'
WHERE visibility IS NULL OR visibility NOT IN ('private','team','organization');

-- ADD COLUMN ... DEFAULT 'private' materializes 'private' on historical rows.
-- Preserve legacy shared views by upgrading only those defaulted rows that
-- still have no team target. This remains safe on an intentional rerun: real
-- team views have team_id and are not rewritten to organization visibility.
UPDATE tenant.crm_lead_saved_views
SET visibility='organization'
WHERE is_shared=true AND visibility='private' AND team_id IS NULL;

UPDATE tenant.crm_lead_saved_views
SET created_by = COALESCE(created_by,user_id),
    updated_by = COALESCE(updated_by,user_id)
WHERE created_by IS NULL OR updated_by IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_visibility_check' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_visibility_check
      CHECK (visibility IN ('private','team','organization'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_team_visibility_check' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_team_visibility_check
      CHECK ((visibility='team' AND team_id IS NOT NULL) OR (visibility<>'team' AND team_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_team_fkey' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_team_fkey
      FOREIGN KEY (organization_id,team_id) REFERENCES tenant.crm_sales_teams(organization_id,id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_company_fkey' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_company_fkey
      FOREIGN KEY (organization_id,company_id) REFERENCES public.companies(organization_id,id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_branch_fkey' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_branch_fkey
      FOREIGN KEY (organization_id,branch_id) REFERENCES public.branches(organization_id,id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_created_by_fkey' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_lead_saved_views_updated_by_fkey' AND conrelid='tenant.crm_lead_saved_views'::regclass) THEN
    ALTER TABLE tenant.crm_lead_saved_views
      ADD CONSTRAINT crm_lead_saved_views_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_lead_saved_views_visibility_idx
  ON tenant.crm_lead_saved_views(organization_id,visibility,team_id,user_id,name);
CREATE INDEX IF NOT EXISTS crm_lead_saved_views_scope_idx
  ON tenant.crm_lead_saved_views(organization_id,company_id,branch_id);

UPDATE tenant.crm_lead_saved_views
SET is_shared=(visibility<>'private');

COMMIT;
