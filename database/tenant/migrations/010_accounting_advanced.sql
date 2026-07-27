BEGIN;

ALTER TABLE tenant.accounting_accounts
  ADD COLUMN IF NOT EXISTS cash_flow_category text,
  ADD COLUMN IF NOT EXISTS financial_statement_group text,
  ADD COLUMN IF NOT EXISTS external_reporting_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.accounting_accounts'::regclass
      AND conname='accounting_accounts_cash_flow_category_check'
  ) THEN
    ALTER TABLE tenant.accounting_accounts
      ADD CONSTRAINT accounting_accounts_cash_flow_category_check
      CHECK (cash_flow_category IS NULL OR cash_flow_category IN ('operating','investing','financing','cash','non_cash')) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.accounting_revaluation_lines
  ADD COLUMN IF NOT EXISTS exposure_type text,
  ADD COLUMN IF NOT EXISTS foreign_currency_code char(3),
  ADD COLUMN IF NOT EXISTS source_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE tenant.accounting_tax_ledger
  DROP CONSTRAINT IF EXISTS accounting_tax_ledger_organization_id_journal_line_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS accounting_tax_ledger_component_uidx
  ON tenant.accounting_tax_ledger(organization_id,journal_line_id,tax_type,direction);
CREATE INDEX IF NOT EXISTS accounting_tax_ledger_period_idx
  ON tenant.accounting_tax_ledger(organization_id,company_id,tax_period,status,tax_type,direction);



CREATE TABLE IF NOT EXISTS tenant.accounting_customer_credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_note_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id) ON DELETE RESTRICT,
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id) ON DELETE RESTRICT,
  allocated_amount numeric(24,6) NOT NULL CHECK (allocated_amount > 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CHECK (credit_note_id <> customer_invoice_id),
  UNIQUE (organization_id,credit_note_id,customer_invoice_id)
);
CREATE INDEX IF NOT EXISTS accounting_customer_credit_allocations_target_idx
  ON tenant.accounting_customer_credit_allocations(organization_id,customer_invoice_id,allocated_at);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_note_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id) ON DELETE RESTRICT,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id) ON DELETE RESTRICT,
  allocated_amount numeric(24,6) NOT NULL CHECK (allocated_amount > 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CHECK (credit_note_id <> vendor_bill_id),
  UNIQUE (organization_id,credit_note_id,vendor_bill_id)
);
CREATE INDEX IF NOT EXISTS accounting_vendor_credit_allocations_target_idx
  ON tenant.accounting_vendor_credit_allocations(organization_id,vendor_bill_id,allocated_at);

CREATE TABLE IF NOT EXISTS tenant.accounting_recurring_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES tenant.accounting_recurring_templates(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','posted','failed','skipped','reversed')),
  error_message text,
  executed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,template_id,scheduled_date)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_accrual_recognitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES tenant.accounting_accrual_schedules(id) ON DELETE CASCADE,
  recognition_date date NOT NULL,
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','posted','reversed','cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  UNIQUE (organization_id,schedule_id,recognition_date)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  asset_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  depreciation_expense_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  disposal_gain_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  disposal_loss_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  default_method text NOT NULL DEFAULT 'straight_line' CHECK (default_method IN ('straight_line','declining_balance','units_of_production','none')),
  default_useful_life_months integer NOT NULL DEFAULT 60 CHECK (default_useful_life_months > 0),
  default_declining_rate numeric(9,6) CHECK (default_declining_rate IS NULL OR default_declining_rate > 0),
  capitalization_threshold numeric(24,6) NOT NULL DEFAULT 0 CHECK (capitalization_threshold >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,ledger_id,code),
  UNIQUE (organization_id,id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE RESTRICT,
  asset_number text NOT NULL,
  category_id uuid NOT NULL REFERENCES tenant.accounting_asset_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  serial_number text,
  source_vendor_bill_id uuid REFERENCES tenant.accounting_vendor_bills(id) ON DELETE SET NULL,
  source_vendor_bill_line_id uuid REFERENCES tenant.accounting_vendor_bill_lines(id) ON DELETE SET NULL,
  acquisition_date date NOT NULL,
  in_service_date date,
  capitalization_date date,
  currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  acquisition_cost numeric(24,6) NOT NULL CHECK (acquisition_cost > 0),
  base_acquisition_cost numeric(24,6) NOT NULL CHECK (base_acquisition_cost > 0),
  salvage_value numeric(24,6) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  depreciation_method text NOT NULL CHECK (depreciation_method IN ('straight_line','declining_balance','units_of_production','none')),
  declining_rate numeric(9,6) CHECK (declining_rate IS NULL OR declining_rate > 0),
  accumulated_depreciation numeric(24,6) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  impairment_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (impairment_amount >= 0),
  net_book_value numeric(24,6) NOT NULL CHECK (net_book_value >= 0),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  location text,
  custodian_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_service','fully_depreciated','suspended','disposed','written_off','cancelled')),
  capitalization_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  disposal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  disposed_at date,
  disposal_proceeds numeric(24,6),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,asset_number),
  UNIQUE (organization_id,id),
  CHECK (salvage_value <= base_acquisition_cost),
  CHECK (accumulated_depreciation + impairment_amount <= base_acquisition_cost)
);
CREATE INDEX IF NOT EXISTS accounting_assets_status_idx
  ON tenant.accounting_assets(organization_id,company_id,status,category_id,in_service_date);

CREATE TABLE IF NOT EXISTS tenant.accounting_asset_depreciation_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES tenant.accounting_assets(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  depreciation_date date NOT NULL,
  fiscal_period_id uuid REFERENCES tenant.fiscal_periods(id) ON DELETE SET NULL,
  opening_book_value numeric(24,6) NOT NULL CHECK (opening_book_value >= 0),
  depreciation_amount numeric(24,6) NOT NULL CHECK (depreciation_amount >= 0),
  impairment_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (impairment_amount >= 0),
  closing_book_value numeric(24,6) NOT NULL CHECK (closing_book_value >= 0),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','posted','reversed','skipped')),
  posted_at timestamptz,
  UNIQUE (organization_id,asset_id,sequence),
  UNIQUE (organization_id,asset_id,depreciation_date)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_asset_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES tenant.accounting_assets(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (transaction_type IN ('acquisition','capitalization','depreciation','impairment','revaluation','transfer','suspension','resumption','disposal','writeoff')),
  transaction_date date NOT NULL,
  amount numeric(24,6) NOT NULL DEFAULT 0,
  from_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  to_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  from_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  to_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  from_cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  to_cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounting_asset_transactions_asset_idx
  ON tenant.accounting_asset_transactions(organization_id,asset_id,transaction_date,created_at);

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  return_type text NOT NULL,
  tax_registration text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  filing_due_date date,
  taxable_amount numeric(24,6) NOT NULL DEFAULT 0,
  output_tax numeric(24,6) NOT NULL DEFAULT 0,
  input_tax_credit numeric(24,6) NOT NULL DEFAULT 0,
  withholding_tax numeric(24,6) NOT NULL DEFAULT 0,
  net_tax_payable numeric(24,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','filed','paid','amended','cancelled')),
  external_reference text,
  filed_at timestamptz,
  filed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  UNIQUE (organization_id,company_id,return_type,tax_registration,period_start,period_end)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tax_return_id uuid NOT NULL REFERENCES tenant.accounting_tax_returns(id) ON DELETE CASCADE,
  tax_ledger_id uuid NOT NULL REFERENCES tenant.accounting_tax_ledger(id) ON DELETE RESTRICT,
  included_amount numeric(24,6) NOT NULL,
  UNIQUE (organization_id,tax_return_id,tax_ledger_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_dunning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  minimum_days_overdue integer NOT NULL DEFAULT 1 CHECK (minimum_days_overdue >= 0),
  minimum_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','issued','completed','cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,run_date)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_dunning_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dunning_run_id uuid NOT NULL REFERENCES tenant.accounting_dunning_runs(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES tenant.accounting_customer_invoices(id) ON DELETE SET NULL,
  level integer NOT NULL DEFAULT 1 CHECK (level > 0),
  overdue_amount numeric(24,6) NOT NULL CHECK (overdue_amount > 0),
  action_type text NOT NULL DEFAULT 'notice' CHECK (action_type IN ('notice','email','call','hold','legal','writeoff_review')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','sent','completed','waived','failed')),
  note text,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS tenant.accounting_consolidation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  reporting_currency_code char(3) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,code),
  UNIQUE (organization_id,id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_consolidation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES tenant.accounting_consolidation_groups(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  ownership_percent numeric(7,4) NOT NULL DEFAULT 100 CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  consolidation_method text NOT NULL DEFAULT 'full' CHECK (consolidation_method IN ('full','proportionate','equity')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  UNIQUE (organization_id,group_id,company_id,ledger_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_consolidation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES tenant.accounting_consolidation_groups(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  reporting_currency_code char(3) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','review','finalized','reopened','cancelled')),
  source_hash text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  finalized_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (organization_id,group_id,period_end)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_consolidation_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  consolidation_run_id uuid NOT NULL REFERENCES tenant.accounting_consolidation_runs(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  account_code text NOT NULL,
  account_name text NOT NULL,
  account_class text NOT NULL,
  local_currency_code char(3),
  local_balance numeric(24,6) NOT NULL DEFAULT 0,
  translation_rate numeric(24,10) NOT NULL DEFAULT 1,
  reporting_balance numeric(24,6) NOT NULL DEFAULT 0,
  elimination_amount numeric(24,6) NOT NULL DEFAULT 0,
  consolidated_balance numeric(24,6) NOT NULL DEFAULT 0,
  UNIQUE (organization_id,consolidation_run_id,company_id,account_code)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_consolidation_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  consolidation_run_id uuid NOT NULL REFERENCES tenant.accounting_consolidation_runs(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('elimination','translation','reclassification','minority_interest','manual')),
  account_code text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  debit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  description text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0))
);
CREATE INDEX IF NOT EXISTS accounting_consolidation_adjustments_run_idx
  ON tenant.accounting_consolidation_adjustments(organization_id,consolidation_run_id,account_code);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_customer_credit_allocations','accounting_vendor_credit_allocations',
    'accounting_recurring_executions','accounting_accrual_recognitions','accounting_asset_categories',
    'accounting_assets','accounting_asset_depreciation_schedule','accounting_asset_transactions',
    'accounting_tax_returns','accounting_tax_return_lines','accounting_dunning_runs','accounting_dunning_actions',
    'accounting_consolidation_groups','accounting_consolidation_members','accounting_consolidation_runs',
    'accounting_consolidation_balances','accounting_consolidation_adjustments'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_asset_categories','accounting_assets','accounting_tax_returns','accounting_consolidation_groups'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I',table_name || '_touch_updated_at',table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()',table_name || '_touch_updated_at',table_name);
  END LOOP;
END $$;

WITH ledger_seed AS (
  SELECT ledger.id AS ledger_id,ledger.organization_id,ledger.company_id,organization.created_by
  FROM tenant.accounting_ledgers ledger
  JOIN public.organizations organization ON organization.id=ledger.organization_id
  WHERE ledger.code='PRIMARY'
)
INSERT INTO tenant.accounting_journals (
  organization_id,company_id,ledger_id,code,name,journal_type,approval_required,created_by,updated_by
)
SELECT organization_id,company_id,ledger_id,'AST','Asset journal','asset',true,created_by,created_by
FROM ledger_seed
ON CONFLICT (organization_id,company_id,code) DO NOTHING;

WITH mapping_seed(mapping_key,account_code) AS (
  VALUES
    ('fixed_asset','1500'),
    ('accumulated_depreciation','1590'),
    ('depreciation_expense','6300'),
    ('asset_disposal_gain','4900'),
    ('asset_disposal_loss','6100')
)
INSERT INTO tenant.accounting_account_mappings (
  organization_id,company_id,ledger_id,mapping_key,account_id,priority,created_by,updated_by
)
SELECT ledger.organization_id,ledger.company_id,ledger.id,seed.mapping_key,account.id,100,
       organization.created_by,organization.created_by
FROM tenant.accounting_ledgers ledger
JOIN public.organizations organization ON organization.id=ledger.organization_id
CROSS JOIN mapping_seed seed
JOIN tenant.accounting_accounts account
  ON account.organization_id=ledger.organization_id AND account.company_id=ledger.company_id
 AND account.ledger_id=ledger.id AND account.code=seed.account_code
WHERE ledger.code='PRIMARY'
ON CONFLICT DO NOTHING;

WITH category_accounts AS (
  SELECT ledger.organization_id,ledger.company_id,ledger.id AS ledger_id,organization.created_by,
    (max(account.id::text) FILTER (WHERE account.code='1500'))::uuid AS asset_account_id,
    (max(account.id::text) FILTER (WHERE account.code='1590'))::uuid AS accumulated_account_id,
    (max(account.id::text) FILTER (WHERE account.code='6300'))::uuid AS depreciation_expense_account_id,
    (max(account.id::text) FILTER (WHERE account.code='4900'))::uuid AS disposal_gain_account_id,
    (max(account.id::text) FILTER (WHERE account.code='6100'))::uuid AS disposal_loss_account_id
  FROM tenant.accounting_ledgers ledger
  JOIN public.organizations organization ON organization.id=ledger.organization_id
  JOIN tenant.accounting_accounts account ON account.ledger_id=ledger.id
  WHERE ledger.code='PRIMARY'
  GROUP BY ledger.organization_id,ledger.company_id,ledger.id,organization.created_by
)
INSERT INTO tenant.accounting_asset_categories (
  organization_id,company_id,ledger_id,code,name,asset_account_id,accumulated_depreciation_account_id,
  depreciation_expense_account_id,disposal_gain_account_id,disposal_loss_account_id,default_method,
  default_useful_life_months,status,created_by,updated_by
)
SELECT organization_id,company_id,ledger_id,'GENERAL','General fixed assets',asset_account_id,accumulated_account_id,
  depreciation_expense_account_id,disposal_gain_account_id,disposal_loss_account_id,'straight_line',60,'active',created_by,created_by
FROM category_accounts
WHERE asset_account_id IS NOT NULL AND accumulated_account_id IS NOT NULL
  AND depreciation_expense_account_id IS NOT NULL AND disposal_gain_account_id IS NOT NULL
  AND disposal_loss_account_id IS NOT NULL
ON CONFLICT (organization_id,company_id,ledger_id,code) DO NOTHING;

UPDATE tenant.accounting_accounts
SET cash_flow_category = CASE
  WHEN account_type IN ('bank','cash') THEN 'cash'
  WHEN account_type IN ('fixed_asset','accumulated_depreciation') THEN 'investing'
  WHEN account_class IN ('equity') OR account_type IN ('non_current_liability') THEN 'financing'
  WHEN account_type IN ('statistical') THEN 'non_cash'
  ELSE 'operating'
END
WHERE cash_flow_category IS NULL;

COMMIT;
