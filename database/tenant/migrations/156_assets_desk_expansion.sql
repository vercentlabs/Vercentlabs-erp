BEGIN;

-- Expands the Assets foundation (migration 047) into the full desk: locations, identity/barcode tags,
-- component hierarchy, documents, an effective-dated movement history, transfer/disposal workflows,
-- value adjustments (revaluation/impairment), usage readings for units-of-production depreciation,
-- downtime, warranties and claims, calibration, and physical-verification campaigns. Party, item,
-- user, department and cost-centre ids stay loosely typed uuids (no FK), the convention every other
-- module uses for shared master data.

ALTER TABLE tenant.asset_settings
  ADD COLUMN IF NOT EXISTS post_to_accounting boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_transfer_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_value_adjustment_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS depreciation_convention text NOT NULL DEFAULT 'full_month'
    CHECK (depreciation_convention IN ('full_month','mid_month','next_month')),
  ADD COLUMN IF NOT EXISTS warranty_alert_days integer NOT NULL DEFAULT 30 CHECK (warranty_alert_days >= 0),
  ADD COLUMN IF NOT EXISTS maintenance_lead_days integer NOT NULL DEFAULT 7 CHECK (maintenance_lead_days >= 0),
  ADD COLUMN IF NOT EXISTS calibration_alert_days integer NOT NULL DEFAULT 30 CHECK (calibration_alert_days >= 0);

ALTER TABLE tenant.asset_categories
  ADD COLUMN IF NOT EXISTS parent_category_id uuid,
  ADD COLUMN IF NOT EXISTS declining_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (declining_rate >= 0 AND declining_rate <= 100),
  ADD COLUMN IF NOT EXISTS depreciation_convention text CHECK (depreciation_convention IN ('full_month','mid_month','next_month')),
  ADD COLUMN IF NOT EXISTS clearing_account_id uuid,
  ADD COLUMN IF NOT EXISTS revaluation_reserve_account_id uuid,
  ADD COLUMN IF NOT EXISTS impairment_loss_account_id uuid,
  ADD COLUMN IF NOT EXISTS proceeds_account_id uuid,
  ADD COLUMN IF NOT EXISTS requires_calibration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tag_prefix text;

-- F234: a hierarchy of sites, buildings, floors, rooms and yards.
CREATE TABLE IF NOT EXISTS tenant.asset_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  location_type text NOT NULL DEFAULT 'site'
    CHECK (location_type IN ('site','building','floor','room','yard','vehicle','other')),
  parent_id uuid REFERENCES tenant.asset_locations(id),
  branch_id uuid,
  address text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

ALTER TABLE tenant.assets
  ADD COLUMN IF NOT EXISTS tag_code text,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES tenant.asset_locations(id),
  ADD COLUMN IF NOT EXISTS parent_asset_id uuid REFERENCES tenant.assets(id),
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS ownership text NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned','leased','loaned')),
  ADD COLUMN IF NOT EXISTS criticality text NOT NULL DEFAULT 'medium' CHECK (criticality IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS condition_rating text NOT NULL DEFAULT 'good' CHECK (condition_rating IN ('excellent','good','fair','poor','critical')),
  ADD COLUMN IF NOT EXISTS total_units numeric(20,6),
  ADD COLUMN IF NOT EXISTS units_used numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impairment_accumulated numeric(20,6) NOT NULL DEFAULT 0 CHECK (impairment_accumulated >= 0),
  ADD COLUMN IF NOT EXISTS revaluation_surplus numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_document_type text,
  ADD COLUMN IF NOT EXISTS source_document_id uuid,
  ADD COLUMN IF NOT EXISTS source_line_id uuid,
  ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'not_required'
    CHECK (accounting_status IN ('not_required','not_configured','posted')),
  ADD COLUMN IF NOT EXISTS capitalization_journal_id uuid,
  ADD COLUMN IF NOT EXISTS calibration_due_date date,
  ADD COLUMN IF NOT EXISTS disposed_at date,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE tenant.assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE tenant.assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('draft','available','assigned','in_maintenance','retired','pending_disposal','lost','disposed'));

CREATE UNIQUE INDEX IF NOT EXISTS assets_tag_code_uidx ON tenant.assets(organization_id,tag_code) WHERE tag_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_source_line_uidx ON tenant.assets(organization_id,source_line_id) WHERE source_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_location_idx ON tenant.assets(organization_id,company_id,location_id);

-- F231/F233: documents and evidence attached to an asset (manuals, invoices, photos by reference).
CREATE TABLE IF NOT EXISTS tenant.asset_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'other'
    CHECK (document_type IN ('invoice','manual','warranty','certificate','photo','insurance','licence','other')),
  title text NOT NULL,
  reference_url text,
  expires_on date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- F241: every custody, location, department and status movement, effective-dated and immutable.
CREATE TABLE IF NOT EXISTS tenant.asset_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  movement_type text NOT NULL
    CHECK (movement_type IN ('assignment','return','transfer','status_change','verification_correction')),
  effective_date date NOT NULL DEFAULT current_date,
  from_user_id uuid, to_user_id uuid,
  from_department_id uuid, to_department_id uuid,
  from_cost_center_id uuid, to_cost_center_id uuid,
  from_branch_id uuid, to_branch_id uuid,
  from_location_id uuid, to_location_id uuid,
  reference_type text,
  reference_id uuid,
  reason text,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_movements_asset_idx ON tenant.asset_movements(organization_id,asset_id,effective_date DESC);

-- F239: transfers gain a submit/approve/reject workflow, locations and custodians.
ALTER TABLE tenant.asset_transfers
  ADD COLUMN IF NOT EXISTS from_location_id uuid,
  ADD COLUMN IF NOT EXISTS to_location_id uuid,
  ADD COLUMN IF NOT EXISTS from_user_id uuid,
  ADD COLUMN IF NOT EXISTS to_user_id uuid,
  ADD COLUMN IF NOT EXISTS effective_date date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS rejected_reason text;
ALTER TABLE tenant.asset_transfers DROP CONSTRAINT IF EXISTS asset_transfers_status_check;
ALTER TABLE tenant.asset_transfers ADD CONSTRAINT asset_transfers_status_check
  CHECK (status IN ('draft','submitted','approved','completed','rejected','cancelled'));

-- F248/F249: depreciation lines belong to a run and record their posting.
ALTER TABLE tenant.asset_depreciation_schedules
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES tenant.asset_depreciation_runs(id),
  ADD COLUMN IF NOT EXISTS units numeric(20,6),
  ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE tenant.asset_depreciation_runs
  ADD COLUMN IF NOT EXISTS accounting_journal_id uuid,
  ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'not_required'
    CHECK (accounting_status IN ('not_required','not_configured','posted','reversed')),
  ADD COLUMN IF NOT EXISTS posted_by uuid,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

-- F247: metered usage that drives units-of-production depreciation.
CREATE TABLE IF NOT EXISTS tenant.asset_usage_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  units numeric(20,6) NOT NULL CHECK (units >= 0),
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id,period_end)
);

-- F250/F251: revaluation and impairment, approved by someone other than the requester.
CREATE TABLE IF NOT EXISTS tenant.asset_value_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  adjustment_number text NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('revaluation','impairment','impairment_reversal')),
  effective_date date NOT NULL,
  previous_net_book_value numeric(20,6) NOT NULL,
  new_net_book_value numeric(20,6) NOT NULL CHECK (new_net_book_value >= 0),
  adjustment_amount numeric(20,6) NOT NULL,
  reason text NOT NULL,
  evidence text,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','posted','rejected','cancelled')),
  accounting_status text NOT NULL DEFAULT 'not_required'
    CHECK (accounting_status IN ('not_required','not_configured','posted')),
  accounting_journal_id uuid,
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,adjustment_number)
);

-- F252-F256: maintenance orders gain their origin and a problem statement; downtime is recorded on its own.
ALTER TABLE tenant.asset_maintenance_plans
  ADD COLUMN IF NOT EXISTS lead_days integer NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  ADD COLUMN IF NOT EXISTS last_completed_date date,
  ADD COLUMN IF NOT EXISTS estimated_hours numeric(10,2),
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(20,6),
  ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE tenant.asset_maintenance_orders
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('plan','manual','breakdown','inspection','calibration')),
  ADD COLUMN IF NOT EXISTS problem_description text,
  ADD COLUMN IF NOT EXISTS failure_cause text,
  ADD COLUMN IF NOT EXISTS took_asset_out_of_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS completed_by uuid;
ALTER TABLE tenant.asset_maintenance_orders DROP CONSTRAINT IF EXISTS asset_maintenance_orders_status_check;
ALTER TABLE tenant.asset_maintenance_orders ADD CONSTRAINT asset_maintenance_orders_status_check
  CHECK (status IN ('planned','scheduled','in_progress','on_hold','completed','cancelled'));

CREATE TABLE IF NOT EXISTS tenant.asset_downtime (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  maintenance_order_id uuid REFERENCES tenant.asset_maintenance_orders(id),
  category text NOT NULL DEFAULT 'breakdown' CHECK (category IN ('breakdown','planned','other')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason text,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS asset_downtime_asset_idx ON tenant.asset_downtime(organization_id,asset_id,started_at DESC);

-- F257: warranties (several per asset) and the claims made against them.
CREATE TABLE IF NOT EXISTS tenant.asset_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id) ON DELETE CASCADE,
  supplier_id uuid,
  provider_name text,
  warranty_type text NOT NULL DEFAULT 'manufacturer' CHECK (warranty_type IN ('manufacturer','extended','service_contract','amc')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  coverage text,
  terms text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS tenant.asset_warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  warranty_id uuid NOT NULL REFERENCES tenant.asset_warranties(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  maintenance_order_id uuid REFERENCES tenant.asset_maintenance_orders(id),
  claim_date date NOT NULL,
  description text NOT NULL,
  claimed_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
  recovered_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','settled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- F258: inspections gain a checklist, an outcome and the corrective work order they raise.
ALTER TABLE tenant.asset_inspections
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS result text NOT NULL DEFAULT 'pass' CHECK (result IN ('pass','conditional','fail')),
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS corrective_order_id uuid REFERENCES tenant.asset_maintenance_orders(id),
  ADD COLUMN IF NOT EXISTS company_scope_note text;

-- F259: calibration of measuring equipment, with as-found / as-left evidence.
CREATE TABLE IF NOT EXISTS tenant.asset_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  calibration_number text NOT NULL,
  calibrated_on date NOT NULL,
  due_on date NOT NULL,
  standard_reference text,
  as_found text,
  as_left text,
  result text NOT NULL CHECK (result IN ('pass','adjusted','fail')),
  certificate_number text,
  performed_by_name text,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on >= calibrated_on),
  UNIQUE (organization_id,calibration_number)
);

-- F260/F261: physical verification campaigns reconcile scanned reality to the register.
CREATE TABLE IF NOT EXISTS tenant.asset_verification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  campaign_number text NOT NULL,
  name text NOT NULL,
  location_id uuid,
  department_id uuid,
  category_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','closed','cancelled')),
  expected_count integer NOT NULL DEFAULT 0,
  started_by uuid,
  started_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,campaign_number)
);
CREATE TABLE IF NOT EXISTS tenant.asset_verification_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES tenant.asset_verification_campaigns(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES tenant.assets(id),
  scanned_tag text,
  expected_location_id uuid,
  expected_user_id uuid,
  found_location_id uuid,
  found_condition text CHECK (found_condition IN ('excellent','good','fair','poor','critical')),
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','matched','missing','unexpected','moved','damaged')),
  resolution_status text NOT NULL DEFAULT 'none' CHECK (resolution_status IN ('none','open','resolved')),
  resolution_note text,
  scanned_by uuid,
  scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_verification_line_uidx
  ON tenant.asset_verification_lines(campaign_id,asset_id) WHERE asset_id IS NOT NULL;

-- F262-F266: the disposal workflow (request, approve, complete) and its accounting outcome.
ALTER TABLE tenant.asset_disposals
  ADD COLUMN IF NOT EXISTS disposal_journal_status text NOT NULL DEFAULT 'not_required'
    CHECK (disposal_journal_status IN ('not_required','not_configured','posted')),
  ADD COLUMN IF NOT EXISTS accumulated_depreciation numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_cost numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS sale_reference text;
ALTER TABLE tenant.asset_disposals DROP CONSTRAINT IF EXISTS asset_disposals_status_check;
ALTER TABLE tenant.asset_disposals ADD CONSTRAINT asset_disposals_status_check
  CHECK (status IN ('draft','pending_approval','approved','completed','rejected','cancelled'));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'asset_locations','asset_documents','asset_movements','asset_usage_readings','asset_value_adjustments',
    'asset_downtime','asset_warranties','asset_warranty_claims','asset_calibrations',
    'asset_verification_campaigns','asset_verification_lines'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON tenant.%I',table_name || '_organization_isolation',table_name);
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',table_name
    );
  END LOOP;
END $$;

COMMIT;
