BEGIN;

-- Wave 0 shared business-document numbering. Allocation is performed with one
-- atomic UPSERT inside the caller's authoritative tenant transaction.
CREATE TABLE IF NOT EXISTS tenant.document_sequences (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  document_type text NOT NULL,
  period_key text NOT NULL DEFAULT 'global',
  prefix text NOT NULL,
  padding integer NOT NULL DEFAULT 6 CHECK (padding BETWEEN 1 AND 18),
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id,document_type,period_key)
);

-- Canonical idempotency ledger. It deliberately participates in the same
-- transaction as the business mutation so a rollback cannot leave a false
-- successful replay record.
CREATE TABLE IF NOT EXISTS tenant.operation_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','completed')),
  aggregate_type text,
  aggregate_id uuid,
  response_payload jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,operation,idempotency_key)
);
CREATE INDEX IF NOT EXISTS operation_idempotency_lookup_idx
  ON tenant.operation_idempotency(organization_id,company_id,operation,created_at DESC);

-- Quality inventory holds need dimensional scope, explicit released quantity,
-- and optimistic versioning so partial/full release is auditable and race safe.
ALTER TABLE tenant.quality_holds
  ADD COLUMN IF NOT EXISTS warehouse_location_id uuid,
  ADD COLUMN IF NOT EXISTS released_quantity numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.quality_holds'::regclass
      AND conname='quality_holds_released_quantity_check'
  ) THEN
    ALTER TABLE tenant.quality_holds
      ADD CONSTRAINT quality_holds_released_quantity_check
      CHECK (released_quantity >= 0 AND released_quantity <= quantity);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant.quality_hold_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  hold_id uuid NOT NULL REFERENCES tenant.quality_holds(id) ON DELETE RESTRICT,
  quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
  reason text NOT NULL,
  released_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS quality_hold_releases_hold_idx
  ON tenant.quality_hold_releases(organization_id,company_id,hold_id,created_at);
CREATE INDEX IF NOT EXISTS quality_holds_stock_gate_idx
  ON tenant.quality_holds(organization_id,company_id,item_id,status,warehouse_id,batch_id,serial_id);

-- Prevent application regressions from ever persisting returned quantity above
-- the sold quantity. NOT VALID keeps migration safe for historical data while
-- enforcing the invariant for all new/updated rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.pos_sale_lines'::regclass
      AND conname='pos_sale_lines_returned_not_above_sold_check'
  ) THEN
    ALTER TABLE tenant.pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_returned_not_above_sold_check
      CHECK (returned_quantity <= quantity) NOT VALID;
  END IF;
END $$;

-- New Wave 0 tables use the same forced organization RLS constitution as the
-- rest of the tenant schema.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'document_sequences',
    'operation_idempotency',
    'quality_hold_releases'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
