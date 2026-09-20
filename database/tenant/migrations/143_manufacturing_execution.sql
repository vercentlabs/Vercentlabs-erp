BEGIN;

-- F169-F171 time, F180 subcontracting, F181 inspections, F182 hold, F188 downtime, F189 maintenance.
ALTER TABLE tenant.manufacturing_work_centers ADD COLUMN IF NOT EXISTS asset_id uuid;
ALTER TABLE tenant.manufacturing_work_orders ADD COLUMN IF NOT EXISTS subcontract_cost numeric(20,6) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tenant.manufacturing_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  work_center_id uuid,
  entry_type text NOT NULL CHECK (entry_type IN ('labor','machine','setup')),
  operator_label text,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  minutes numeric(12,2) NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  rate numeric(20,6) NOT NULL DEFAULT 0,
  cost numeric(20,6) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturing_time_entries_wo_idx ON tenant.manufacturing_time_entries (organization_id, work_order_id, operation_id);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_downtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_center_id uuid NOT NULL,
  work_order_id uuid,
  category text NOT NULL CHECK (category IN ('planned','unplanned')),
  reason_code text NOT NULL,
  note text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  minutes numeric(12,2),
  stopped_work_center boolean NOT NULL DEFAULT false,
  maintenance_order_id uuid,
  logged_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturing_downtime_center_idx ON tenant.manufacturing_downtime_events (organization_id, work_center_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  operation_id uuid,
  quantity_inspected numeric(20,6) NOT NULL CHECK (quantity_inspected > 0),
  quantity_rejected numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0),
  result text NOT NULL CHECK (result IN ('pass','fail')),
  defect_code text,
  notes text,
  follow_up text NOT NULL DEFAULT 'none' CHECK (follow_up IN ('none','scrap','hold')),
  inspected_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_subcontract_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  supplier_label text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received','cancelled')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  expected_return date,
  received_at timestamptz,
  quantity_good numeric(20,6),
  cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  note text,
  sent_by uuid NOT NULL,
  received_by uuid
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['manufacturing_time_entries','manufacturing_downtime_events','manufacturing_inspections','manufacturing_subcontract_jobs'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
