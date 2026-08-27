BEGIN;

-- F012 Sales Stages hardens the existing canonical crm_pipeline_stages table.
-- Existing identifiers stay stable; no parallel stage subsystem is introduced.
UPDATE tenant.crm_pipeline_stages
SET code = 'LEGACY_' || upper(left(id::text, 8)),
    updated_at = now()
WHERE btrim(code) = '';

UPDATE tenant.crm_pipeline_stages
SET name = coalesce(nullif(btrim(code), ''), 'Stage ' || left(id::text, 8)),
    updated_at = now()
WHERE btrim(name) = '';

UPDATE tenant.crm_pipeline_stages
SET probability = 100,
    forecast_category = 'closed',
    stale_after_days = NULL,
    updated_at = now()
WHERE is_won = true;

UPDATE tenant.crm_pipeline_stages
SET probability = 0,
    forecast_category = 'closed',
    stale_after_days = NULL,
    updated_at = now()
WHERE is_lost = true;

UPDATE tenant.crm_pipeline_stages
SET forecast_category = 'pipeline',
    updated_at = now()
WHERE is_won = false AND is_lost = false AND forecast_category = 'closed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_pipeline_stages'::regclass
      AND conname='crm_pipeline_stages_code_nonblank_f012'
  ) THEN
    ALTER TABLE tenant.crm_pipeline_stages
      ADD CONSTRAINT crm_pipeline_stages_code_nonblank_f012
      CHECK (btrim(code) <> '');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_pipeline_stages'::regclass
      AND conname='crm_pipeline_stages_name_nonblank_f012'
  ) THEN
    ALTER TABLE tenant.crm_pipeline_stages
      ADD CONSTRAINT crm_pipeline_stages_name_nonblank_f012
      CHECK (btrim(name) <> '');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_pipeline_stages'::regclass
      AND conname='crm_pipeline_stages_won_semantics_f012'
  ) THEN
    ALTER TABLE tenant.crm_pipeline_stages
      ADD CONSTRAINT crm_pipeline_stages_won_semantics_f012
      CHECK (NOT is_won OR (probability = 100 AND forecast_category = 'closed' AND stale_after_days IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_pipeline_stages'::regclass
      AND conname='crm_pipeline_stages_lost_semantics_f012'
  ) THEN
    ALTER TABLE tenant.crm_pipeline_stages
      ADD CONSTRAINT crm_pipeline_stages_lost_semantics_f012
      CHECK (NOT is_lost OR (probability = 0 AND forecast_category = 'closed' AND stale_after_days IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_pipeline_stages'::regclass
      AND conname='crm_pipeline_stages_open_semantics_f012'
  ) THEN
    ALTER TABLE tenant.crm_pipeline_stages
      ADD CONSTRAINT crm_pipeline_stages_open_semantics_f012
      CHECK (is_won OR is_lost OR forecast_category <> 'closed');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_pipeline_stages_f012_catalogue_idx
  ON tenant.crm_pipeline_stages(organization_id,pipeline_id,status,sequence,id);

CREATE TABLE IF NOT EXISTS tenant.crm_sales_stage_configuration_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','deactivated','reactivated','reordered')),
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,pipeline_id)
    REFERENCES tenant.crm_pipelines(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,stage_id)
    REFERENCES tenant.crm_pipeline_stages(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS crm_sales_stage_history_f012_lookup_idx
  ON tenant.crm_sales_stage_configuration_history(organization_id,pipeline_id,stage_id,changed_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_sales_stage_history_immutable_f012()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sales-stage configuration history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_sales_stage_history_immutable_f012
  ON tenant.crm_sales_stage_configuration_history;
CREATE TRIGGER crm_sales_stage_history_immutable_f012
BEFORE UPDATE OR DELETE ON tenant.crm_sales_stage_configuration_history
FOR EACH ROW EXECUTE FUNCTION tenant.crm_sales_stage_history_immutable_f012();

ALTER TABLE tenant.crm_sales_stage_configuration_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_sales_stage_configuration_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_sales_stage_configuration_history;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_sales_stage_configuration_history
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON TABLE tenant.crm_sales_stage_configuration_history
  IS 'Immutable F012 ledger for governed sales-stage catalogue changes.';

COMMIT;
