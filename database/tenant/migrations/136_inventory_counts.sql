BEGIN;

-- F126-F128: cycle counts and physical inventory. A count snapshots the system quantity per
-- (item, location, batch), records what was physically counted, is reviewed and approved by a
-- DIFFERENT person, and only then posts the variances as stock adjustments.
CREATE TABLE IF NOT EXISTS tenant.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  count_number text NOT NULL,
  count_type text NOT NULL CHECK (count_type IN ('cycle','physical')),
  warehouse_id uuid NOT NULL,
  warehouse_location_id uuid,
  group_id uuid,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting','review','posted','cancelled')),
  freeze_stock boolean NOT NULL DEFAULT false,
  blind boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid NOT NULL,
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  posted_at timestamptz,
  rejection_reason text,
  cancel_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, count_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_counts_idempotency_idx ON tenant.stock_counts (organization_id, company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_counts_lookup_idx ON tenant.stock_counts (organization_id, company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL REFERENCES tenant.stock_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_location_id uuid,
  batch_id uuid,
  system_quantity numeric(20,6) NOT NULL DEFAULT 0,
  counted_quantity numeric(20,6) CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  variance_reason text,
  counted_by uuid,
  counted_at timestamptz,
  movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_lines_key_idx ON tenant.stock_count_lines (count_id, item_id, COALESCE(warehouse_location_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid));

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['stock_counts','stock_count_lines'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
