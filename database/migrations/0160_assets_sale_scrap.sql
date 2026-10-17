-- Assets — Asset Sale / Scrap: the execution of an approved SALE or SCRAP disposal inside the same disposal case (no second sale ledger) —
-- agreed price and currency per asset (revised only by an authorized person), scrap method and recycler, scrap / destruction evidence,
-- dispatch through a carrier (in transit until the buyer's receipt), proceeds allocated per asset from the authoritative Sales Invoice
-- (deterministically, never twice), a disposal-linked Sales Invoice generated once, and a buyer's return through a Credit Note. Additive:
--
--   1. line terms       agreed price, currency, price revision, scrap method, certificate requirement and evidence, dispatch, return.
--   2. case terms       sale currency, default scrap method, the Sales Invoice generated from the case (once).
--   3. allocations      the proceeds of each asset from a Sales Invoice: one active allocation per asset and per invoice line.
--   4. category flag    scrap evidence required (e-waste, batteries, regulated waste).
--   5. permissions      manage_sale, manage_scrap, record_evidence.

-- ============================================================ 1. line terms
ALTER TABLE tenant.asset_disposal_lines
  ADD COLUMN IF NOT EXISTS agreed_price numeric(18,2) CHECK (agreed_price IS NULL OR agreed_price >= 0),
  ADD COLUMN IF NOT EXISTS agreed_currency character(3),
  ADD COLUMN IF NOT EXISTS price_revised_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS price_revised_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_revision_reason text,
  ADD COLUMN IF NOT EXISTS scrap_method text CHECK (scrap_method IS NULL OR scrap_method IN ('RECYCLER_COLLECTION', 'SUPERVISED_DESTRUCTION', 'SCRAP_DEALER_SALE')),
  ADD COLUMN IF NOT EXISTS certificate_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_number text,
  ADD COLUMN IF NOT EXISTS certificate_issuer text,
  ADD COLUMN IF NOT EXISTS certificate_date date,
  ADD COLUMN IF NOT EXISTS evidence_references text,
  ADD COLUMN IF NOT EXISTS evidence_recorded_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS evidence_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS dispatch_reference text,
  ADD COLUMN IF NOT EXISTS sale_invoice_line_id uuid,
  ADD COLUMN IF NOT EXISTS return_credit_note_id uuid,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

-- ============================================================ 2. case terms
ALTER TABLE tenant.asset_disposal_cases
  ADD COLUMN IF NOT EXISTS sale_currency character(3),
  ADD COLUMN IF NOT EXISTS scrap_method text CHECK (scrap_method IS NULL OR scrap_method IN ('RECYCLER_COLLECTION', 'SUPERVISED_DESTRUCTION', 'SCRAP_DEALER_SALE')),
  ADD COLUMN IF NOT EXISTS generated_invoice_id uuid;
-- One Sales Invoice is generated from a case, however often the request is retried.
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_cases_invoice_idx ON tenant.asset_disposal_cases (generated_invoice_id) WHERE generated_invoice_id IS NOT NULL;

-- ============================================================ 3. proceeds allocations
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_proceeds_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES tenant.asset_disposal_cases(id),
  line_id uuid NOT NULL REFERENCES tenant.asset_disposal_lines(id),
  invoice_id uuid NOT NULL,
  invoice_line_id uuid,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  basis text NOT NULL CHECK (basis IN ('INVOICE_LINE', 'AGREED_PRICE', 'EQUAL', 'MANUAL')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  allocated_by uuid REFERENCES public.users(id),
  allocated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at timestamptz,
  CONSTRAINT asset_disposal_allocations_status_check CHECK ((status = 'ACTIVE') = (superseded_at IS NULL))
);
-- No asset holds two active proceeds allocations, and no invoice line is allocated twice.
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_allocations_line_idx ON tenant.asset_disposal_proceeds_allocations (line_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_allocations_invoice_line_idx ON tenant.asset_disposal_proceeds_allocations (invoice_line_id) WHERE status = 'ACTIVE' AND invoice_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_disposal_allocations_invoice_idx ON tenant.asset_disposal_proceeds_allocations (invoice_id) WHERE status = 'ACTIVE';
CREATE OR REPLACE FUNCTION tenant.asset_disposal_allocations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An allocation is superseded, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'ACTIVE' THEN RAISE EXCEPTION 'A superseded allocation stays as it was.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.line_id <> OLD.line_id OR NEW.invoice_id <> OLD.invoice_id THEN RAISE EXCEPTION 'An allocation is superseded, never rewritten.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_disposal_allocations_guard') THEN
    CREATE TRIGGER asset_disposal_allocations_guard BEFORE UPDATE OR DELETE ON tenant.asset_disposal_proceeds_allocations FOR EACH ROW EXECUTE FUNCTION tenant.asset_disposal_allocations_guard();
  END IF;
END $$;
ALTER TABLE tenant.asset_disposal_proceeds_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.asset_disposal_proceeds_allocations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'asset_disposal_proceeds_allocations' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.asset_disposal_proceeds_allocations USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_disposal_proceeds_allocations TO vercent_app, vercent_worker;
-- Existing links (MVP 25) are the first allocations.
INSERT INTO tenant.asset_disposal_proceeds_allocations (organization_id, case_id, line_id, invoice_id, amount, basis, allocated_at)
SELECT l.organization_id, l.case_id, l.id, l.sale_invoice_id, l.sale_proceeds, 'MANUAL', clock_timestamp() FROM tenant.asset_disposal_lines l
WHERE l.sale_invoice_id IS NOT NULL AND l.sale_proceeds IS NOT NULL AND l.line_status NOT IN ('CANCELLED', 'REJECTED', 'REINSTATED')
  AND NOT EXISTS (SELECT 1 FROM tenant.asset_disposal_proceeds_allocations x WHERE x.line_id = l.id AND x.status = 'ACTIVE');

-- ============================================================ 4. category flag
ALTER TABLE tenant.asset_categories ADD COLUMN IF NOT EXISTS scrap_evidence_required boolean NOT NULL DEFAULT false;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.disposal.manage_sale', 'Manage asset sales', 'Assets', 'Set the buyer, agreed price, proceeds allocation and Sales Invoice of a sale.'),
  ('assets.disposal.manage_scrap', 'Manage asset scrapping', 'Assets', 'Set the scrap method, recycler and scrap value.'),
  ('assets.disposal.record_evidence', 'Record disposal evidence', 'Assets', 'Record scrap and destruction certificates and evidence.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.disposal.manage_sale'), ('asset_manager', 'assets.disposal.manage_scrap'), ('asset_manager', 'assets.disposal.record_evidence'),
    ('finance_manager', 'assets.disposal.manage_sale'), ('accountant', 'assets.disposal.manage_sale'),
    ('inventory_manager', 'assets.disposal.record_evidence')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0160_assets_sale_scrap.sql', 'assets-sale-scrap') ON CONFLICT DO NOTHING;
