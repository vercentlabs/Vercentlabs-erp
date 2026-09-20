BEGIN;

-- F135-F137: picking, packing and shipping. A pick list reserves the stock it asks for; picking
-- records what was actually found; packing assigns picked quantities to packages; shipping consumes
-- the reservation and issues the stock (one ledger movement per line), so stock leaves exactly once.
CREATE TABLE IF NOT EXISTS tenant.stock_pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  pick_number text NOT NULL,
  warehouse_id uuid NOT NULL,
  reference_type text,
  reference_id uuid,
  reference_label text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','picking','picked','packing','packed','shipped','cancelled')),
  notes text,
  created_by uuid NOT NULL,
  picked_at timestamptz,
  packed_at timestamptz,
  shipped_by uuid,
  shipped_at timestamptz,
  carrier text,
  tracking_number text,
  cancel_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, pick_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_pick_lists_idem_idx ON tenant.stock_pick_lists (organization_id, company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.stock_pick_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  pick_list_id uuid NOT NULL REFERENCES tenant.stock_pick_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_location_id uuid,
  batch_id uuid,
  requested_quantity numeric(20,6) NOT NULL CHECK (requested_quantity > 0),
  picked_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
  short_reason text,
  reservation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.stock_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  pick_list_id uuid NOT NULL REFERENCES tenant.stock_pick_lists(id) ON DELETE CASCADE,
  package_number text NOT NULL,
  weight_kg numeric(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pick_list_id, package_number)
);

CREATE TABLE IF NOT EXISTS tenant.stock_package_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  package_id uuid NOT NULL REFERENCES tenant.stock_packages(id) ON DELETE CASCADE,
  pick_line_id uuid NOT NULL REFERENCES tenant.stock_pick_lines(id) ON DELETE CASCADE,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['stock_pick_lists','stock_pick_lines','stock_packages','stock_package_lines'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
