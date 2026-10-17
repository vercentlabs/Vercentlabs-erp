-- Assets — Gain / Loss on Disposal: the Finance-controlled, versioned calculation inside the disposal case (no second gain/loss ledger). Each
-- calculation is a snapshot version — a preview anyone with the financials may run, or the version Finance approves — with the gross and
-- GST-exclusive consideration (converted at Finance's rate), source-linked disposal costs and their treatment, other adjustments and the basis
-- source; posting needs the approved, still-current version; a posted result is corrected by a linked reversal and adjustment. Additive:
--
--   1. snapshots    version, kind (preview / approved / adjustment), consideration, tax, currency and rate, costs, adjustments, basis source.
--   2. cost links   actual disposal costs from posted supplier bills, allocated per asset, reducing proceeds or kept as a separate expense.
--   3. intents      the kind of posting (derecognition or adjustment) and the intent it adjusts.
--   4. accounts     an optional separate loss-on-disposal account per category.
--   5. insurance    a claim recorded beside the disposal — never netted against the loss.

-- ============================================================ 1. snapshots
ALTER TABLE tenant.asset_disposal_financial_snapshots
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'APPROVED' CHECK (kind IN ('PREVIEW', 'APPROVED', 'ADJUSTMENT')),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS calculation_version text NOT NULL DEFAULT 'disposal-gl-1',
  ADD COLUMN IF NOT EXISTS gross_consideration numeric(18,2),
  ADD COLUMN IF NOT EXISTS consideration_tax numeric(18,2),
  ADD COLUMN IF NOT EXISTS consideration_currency character(3),
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS other_adjustments numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS separate_costs numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costs_estimated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS basis_source text,
  ADD COLUMN IF NOT EXISTS loss_account_id uuid,
  ADD COLUMN IF NOT EXISTS supersedes_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS reason text;
CREATE INDEX IF NOT EXISTS asset_disposal_snapshots_line_idx ON tenant.asset_disposal_financial_snapshots (line_id, version);

-- ============================================================ 2. disposal cost links
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_cost_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES tenant.asset_disposal_cases(id),
  line_id uuid NOT NULL REFERENCES tenant.asset_disposal_lines(id),
  source_type text NOT NULL DEFAULT 'SUPPLIER_BILL' CHECK (source_type IN ('SUPPLIER_BILL')),
  source_id uuid NOT NULL,
  source_number text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  treatment text NOT NULL DEFAULT 'NET_PROCEEDS' CHECK (treatment IN ('NET_PROCEEDS', 'SEPARATE_EXPENSE')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'UNLINKED')),
  linked_by uuid REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  unlinked_by uuid REFERENCES public.users(id),
  unlinked_at timestamptz,
  unlink_reason text,
  CONSTRAINT asset_disposal_cost_links_unlinked_check CHECK ((status = 'ACTIVE') = (unlinked_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_cost_links_line_source_idx ON tenant.asset_disposal_cost_links (line_id, source_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_disposal_cost_links_source_idx ON tenant.asset_disposal_cost_links (source_id) WHERE status = 'ACTIVE';
ALTER TABLE tenant.asset_disposal_cost_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.asset_disposal_cost_links FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'asset_disposal_cost_links' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.asset_disposal_cost_links USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_disposal_cost_links TO vercent_app, vercent_worker;

-- ============================================================ 3. intents
ALTER TABLE tenant.asset_disposal_accounting_intents
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'DERECOGNITION' CHECK (kind IN ('DERECOGNITION', 'ADJUSTMENT')),
  ADD COLUMN IF NOT EXISTS adjusts_intent_id uuid REFERENCES tenant.asset_disposal_accounting_intents(id);

-- ============================================================ 4. accounts
ALTER TABLE tenant.asset_categories ADD COLUMN IF NOT EXISTS disposal_loss_account_id uuid;

-- ============================================================ 5. insurance
ALTER TABLE tenant.asset_disposal_lines
  ADD COLUMN IF NOT EXISTS insurance_claim_reference text,
  ADD COLUMN IF NOT EXISTS insurance_expected_amount numeric(18,2) CHECK (insurance_expected_amount IS NULL OR insurance_expected_amount >= 0);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0161_assets_disposal_gain_loss.sql', 'assets-disposal-gain-loss') ON CONFLICT DO NOTHING;
