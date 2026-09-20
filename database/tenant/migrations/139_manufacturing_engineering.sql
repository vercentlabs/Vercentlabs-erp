BEGIN;

-- F145-F149, F190: BOM approval workflow, revisions, alternates and engineering change control.
ALTER TABLE tenant.manufacturing_boms DROP CONSTRAINT IF EXISTS manufacturing_boms_status_check;
ALTER TABLE tenant.manufacturing_boms ADD CONSTRAINT manufacturing_boms_status_check CHECK (status IN ('draft','pending_approval','active','inactive','obsolete'));
ALTER TABLE tenant.manufacturing_boms
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS revision text,
  ADD COLUMN IF NOT EXISTS revision_note text,
  ADD COLUMN IF NOT EXISTS supersedes_bom_id uuid,
  ADD COLUMN IF NOT EXISTS is_alternate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alternate_priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS obsolete_reason text;
CREATE INDEX IF NOT EXISTS manufacturing_boms_item_idx ON tenant.manufacturing_boms (organization_id, company_id, item_id, status);
CREATE INDEX IF NOT EXISTS manufacturing_bom_components_item_idx ON tenant.manufacturing_bom_components (organization_id, item_id);

-- Substitute components: another item that may be used in place of a component, at a ratio.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_component_alternates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_component_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_components(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  ratio numeric(20,6) NOT NULL DEFAULT 1 CHECK (ratio > 0),
  priority integer NOT NULL DEFAULT 1,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bom_component_id, item_id)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_engineering_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  change_number text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  target_bom_id uuid NOT NULL,
  proposed_components jsonb NOT NULL,
  effective_from date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','implemented','cancelled')),
  requested_by uuid NOT NULL,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  resulting_bom_id uuid,
  implemented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, change_number)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['manufacturing_bom_component_alternates','manufacturing_engineering_changes'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
