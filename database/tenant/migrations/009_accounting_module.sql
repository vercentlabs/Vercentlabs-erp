BEGIN;

ALTER TABLE tenant.fiscal_periods
  ADD COLUMN IF NOT EXISTS period_number integer,
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS soft_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS soft_closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.fiscal_periods'::regclass
      AND conname = 'fiscal_periods_period_type_check'
  ) THEN
    ALTER TABLE tenant.fiscal_periods
      ADD CONSTRAINT fiscal_periods_period_type_check
      CHECK (period_type IN ('standard','adjustment','opening','closing')) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant.accounting_settings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  default_ledger_id uuid,
  retained_earnings_account_id uuid,
  suspense_account_id uuid,
  rounding_account_id uuid,
  realized_gain_account_id uuid,
  realized_loss_account_id uuid,
  unrealized_gain_account_id uuid,
  unrealized_loss_account_id uuid,
  default_receivable_account_id uuid,
  default_payable_account_id uuid,
  default_revenue_account_id uuid,
  default_expense_account_id uuid,
  default_output_tax_account_id uuid,
  default_input_tax_account_id uuid,
  bank_suspense_account_id uuid,
  writeoff_account_id uuid,
  cash_basis_enabled boolean NOT NULL DEFAULT false,
  auto_post_sales_invoices boolean NOT NULL DEFAULT false,
  auto_post_vendor_bills boolean NOT NULL DEFAULT false,
  journal_approval_threshold numeric(24,6) NOT NULL DEFAULT 0 CHECK (journal_approval_threshold >= 0),
  hard_close_requires_all_tasks boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  ledger_type text NOT NULL DEFAULT 'primary' CHECK (ledger_type IN ('primary','secondary','reporting','tax')),
  accounting_standard text NOT NULL DEFAULT 'local_gaap',
  functional_currency_code char(3) NOT NULL,
  chart_code text NOT NULL DEFAULT 'OPERATING',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_ledgers_primary_company_idx
  ON tenant.accounting_ledgers(organization_id, company_id)
  WHERE ledger_type = 'primary' AND status = 'active';

CREATE TABLE IF NOT EXISTS tenant.accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  account_class text NOT NULL CHECK (account_class IN ('asset','liability','equity','revenue','expense','memorandum')),
  account_type text NOT NULL CHECK (account_type IN (
    'group','bank','cash','receivable','payable','inventory','fixed_asset','accumulated_depreciation',
    'tax_input','tax_output','revenue','other_income','cogs','expense','other_expense','equity',
    'retained_earnings','current_asset','non_current_asset','current_liability','non_current_liability',
    'suspense','rounding','fx_gain','fx_loss','intercompany','statistical'
  )),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  is_group boolean NOT NULL DEFAULT false,
  allow_manual_posting boolean NOT NULL DEFAULT true,
  reconciliation_required boolean NOT NULL DEFAULT false,
  currency_code char(3),
  tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, ledger_id, code),
  UNIQUE (organization_id, id),
  CHECK (NOT is_group OR account_type = 'group')
);
CREATE INDEX IF NOT EXISTS accounting_accounts_tree_idx
  ON tenant.accounting_accounts(organization_id, company_id, ledger_id, parent_id, code);

CREATE TABLE IF NOT EXISTS tenant.accounting_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  mapping_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  item_id uuid REFERENCES tenant.items(id) ON DELETE CASCADE,
  item_group_id uuid REFERENCES tenant.item_groups(id) ON DELETE CASCADE,
  tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 10000),
  effective_from date,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to),
  UNIQUE (organization_id, company_id, ledger_id, mapping_key, branch_id, party_id, item_id, item_group_id, tax_category_id, effective_from)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'custom' CHECK (source_type IN ('branch','department','cost_center','project','custom')),
  required_for_classes text[] NOT NULL DEFAULT ARRAY[]::text[],
  balancing_dimension boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_dimension_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dimension_id uuid NOT NULL REFERENCES tenant.accounting_dimensions(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES tenant.accounting_dimension_values(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  source_record_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dimension_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  journal_type text NOT NULL CHECK (journal_type IN ('general','sales','purchase','bank','cash','tax','inventory','payroll','asset','intercompany','opening','closing')),
  default_debit_account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE SET NULL,
  default_credit_account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE SET NULL,
  sequence_entity_type text NOT NULL DEFAULT 'journal_entry',
  approval_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE RESTRICT,
  journal_id uuid NOT NULL REFERENCES tenant.accounting_journals(id) ON DELETE RESTRICT,
  fiscal_period_id uuid NOT NULL REFERENCES tenant.fiscal_periods(id) ON DELETE RESTRICT,
  entry_number text NOT NULL,
  entry_date date NOT NULL,
  accounting_date date NOT NULL,
  document_date date,
  entry_type text NOT NULL DEFAULT 'standard' CHECK (entry_type IN ('standard','opening','closing','adjustment','accrual','deferral','revaluation','allocation','reversal','intercompany','subledger')),
  source_module text NOT NULL DEFAULT 'accounting',
  source_type text,
  source_id uuid,
  source_number text,
  reference text,
  description text NOT NULL,
  currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','posted','rejected','reversed','cancelled')),
  approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  content_hash text,
  reversal_of_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE RESTRICT,
  reversed_by_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  reversal_reason text,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entry_number),
  UNIQUE (organization_id, source_module, source_type, source_id, entry_type),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS accounting_journal_entries_list_idx
  ON tenant.accounting_journal_entries(organization_id, company_id, accounting_date DESC, status);
CREATE INDEX IF NOT EXISTS accounting_journal_entries_source_idx
  ON tenant.accounting_journal_entries(organization_id, source_module, source_type, source_id);

CREATE TABLE IF NOT EXISTS tenant.accounting_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES tenant.accounting_journal_entries(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  description text,
  currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  debit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  base_debit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (base_debit_amount >= 0),
  base_credit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (base_credit_amount >= 0),
  due_date date,
  reference_type text,
  reference_id uuid,
  tax_code text,
  tax_base_amount numeric(24,6) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  CHECK ((base_debit_amount > 0 AND base_credit_amount = 0) OR (base_credit_amount > 0 AND base_debit_amount = 0)),
  UNIQUE (organization_id, journal_entry_id, sequence),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS accounting_journal_lines_account_idx
  ON tenant.accounting_journal_lines(organization_id, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS accounting_journal_lines_party_idx
  ON tenant.accounting_journal_lines(organization_id, party_id, created_at DESC) WHERE party_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.accounting_line_dimensions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_line_id uuid NOT NULL REFERENCES tenant.accounting_journal_lines(id) ON DELETE CASCADE,
  dimension_id uuid NOT NULL REFERENCES tenant.accounting_dimensions(id) ON DELETE CASCADE,
  dimension_value_id uuid NOT NULL REFERENCES tenant.accounting_dimension_values(id) ON DELETE RESTRICT,
  allocation_percent numeric(9,4) NOT NULL DEFAULT 100 CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  PRIMARY KEY (journal_line_id, dimension_id, dimension_value_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_posting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  event_class text NOT NULL,
  event_type text NOT NULL,
  line_role text NOT NULL,
  account_mapping_key text NOT NULL,
  debit_or_credit text NOT NULL CHECK (debit_or_credit IN ('debit','credit')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 10000),
  condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, ledger_id, event_class, event_type, line_role, priority)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_subledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_class text NOT NULL,
  event_type text NOT NULL,
  source_module text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  event_date date NOT NULL,
  accounting_date date NOT NULL,
  currency_code char(3) NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accounted','failed','cancelled')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accounted_at timestamptz,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, source_module, source_type, source_id, event_type)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  invoice_type text NOT NULL DEFAULT 'invoice' CHECK (invoice_type IN ('invoice','credit_note','debit_note','opening')),
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  billing_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  source_sales_order_id uuid REFERENCES tenant.sales_orders(id) ON DELETE SET NULL,
  source_sales_invoice_request_id uuid REFERENCES tenant.sales_invoice_requests(id) ON DELETE SET NULL,
  source_invoice_id uuid REFERENCES tenant.accounting_customer_invoices(id) ON DELETE SET NULL,
  invoice_date date NOT NULL,
  accounting_date date NOT NULL,
  due_date date NOT NULL,
  currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_term_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  place_of_supply text,
  supply_type text NOT NULL DEFAULT 'domestic' CHECK (supply_type IN ('domestic','export','sez','exempt','non_gst')),
  subtotal numeric(24,6) NOT NULL DEFAULT 0,
  discount_total numeric(24,6) NOT NULL DEFAULT 0,
  charge_total numeric(24,6) NOT NULL DEFAULT 0,
  tax_total numeric(24,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(24,6) NOT NULL DEFAULT 0,
  grand_total numeric(24,6) NOT NULL DEFAULT 0,
  base_currency_total numeric(24,6) NOT NULL DEFAULT 0,
  outstanding_amount numeric(24,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','posted','partially_paid','paid','overdue','disputed','cancelled','reversed')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  e_invoice_status text NOT NULL DEFAULT 'not_applicable' CHECK (e_invoice_status IN ('not_applicable','pending','generated','cancelled','failed')),
  e_invoice_reference text,
  notes text,
  terms_and_conditions text,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_number),
  UNIQUE (organization_id, source_sales_invoice_request_id),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS accounting_customer_invoices_aging_idx
  ON tenant.accounting_customer_invoices(organization_id, company_id, party_id, due_date, status);

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  source_sales_order_line_id uuid REFERENCES tenant.sales_order_lines(id) ON DELETE SET NULL,
  item_id uuid REFERENCES tenant.items(id) ON DELETE SET NULL,
  description text NOT NULL,
  hsn_sac_code text,
  quantity numeric(24,10) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  uom_id uuid REFERENCES tenant.units_of_measure(id) ON DELETE SET NULL,
  unit_price numeric(24,10) NOT NULL DEFAULT 0,
  discount_amount numeric(24,6) NOT NULL DEFAULT 0,
  net_amount numeric(24,6) NOT NULL DEFAULT 0,
  tax_amount numeric(24,6) NOT NULL DEFAULT 0,
  line_total numeric(24,6) NOT NULL DEFAULT 0,
  revenue_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  tax_account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  tax_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, customer_invoice_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_invoice_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  due_date date NOT NULL,
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  outstanding_amount numeric(24,6) NOT NULL CHECK (outstanding_amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','overdue','written_off')),
  UNIQUE (organization_id, customer_invoice_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE RESTRICT,
  receipt_number text NOT NULL,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  bank_account_id uuid,
  receipt_date date NOT NULL,
  accounting_date date NOT NULL,
  currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  base_amount numeric(24,6) NOT NULL CHECK (base_amount > 0),
  unapplied_amount numeric(24,6) NOT NULL CHECK (unapplied_amount >= 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('cash','bank_transfer','card','upi','cheque','gateway','other')),
  external_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','partially_applied','applied','reversed','cancelled')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_number),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES tenant.accounting_customer_receipts(id) ON DELETE CASCADE,
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id) ON DELETE RESTRICT,
  schedule_id uuid REFERENCES tenant.accounting_customer_invoice_schedules(id) ON DELETE SET NULL,
  allocated_amount numeric(24,6) NOT NULL CHECK (allocated_amount > 0),
  realized_gain_loss numeric(24,6) NOT NULL DEFAULT 0,
  discount_taken numeric(24,6) NOT NULL DEFAULT 0 CHECK (discount_taken >= 0),
  writeoff_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (writeoff_amount >= 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, receipt_id, customer_invoice_id, schedule_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE RESTRICT,
  bill_number text NOT NULL,
  supplier_invoice_number text,
  bill_type text NOT NULL DEFAULT 'bill' CHECK (bill_type IN ('bill','credit_note','debit_note','opening')),
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  source_purchase_order_id uuid,
  source_goods_receipt_id uuid,
  source_bill_id uuid REFERENCES tenant.accounting_vendor_bills(id) ON DELETE SET NULL,
  bill_date date NOT NULL,
  accounting_date date NOT NULL,
  due_date date NOT NULL,
  currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  supplier_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_term_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal numeric(24,6) NOT NULL DEFAULT 0,
  discount_total numeric(24,6) NOT NULL DEFAULT 0,
  charge_total numeric(24,6) NOT NULL DEFAULT 0,
  tax_total numeric(24,6) NOT NULL DEFAULT 0,
  withholding_total numeric(24,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(24,6) NOT NULL DEFAULT 0,
  grand_total numeric(24,6) NOT NULL DEFAULT 0,
  base_currency_total numeric(24,6) NOT NULL DEFAULT 0,
  outstanding_amount numeric(24,6) NOT NULL DEFAULT 0,
  matching_status text NOT NULL DEFAULT 'not_required' CHECK (matching_status IN ('not_required','pending','matched','exception','overridden')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','posted','partially_paid','paid','overdue','disputed','cancelled','reversed')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  notes text,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bill_number),
  UNIQUE (organization_id, party_id, supplier_invoice_number),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS accounting_vendor_bills_aging_idx
  ON tenant.accounting_vendor_bills(organization_id, company_id, party_id, due_date, status);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  item_id uuid REFERENCES tenant.items(id) ON DELETE SET NULL,
  description text NOT NULL,
  hsn_sac_code text,
  quantity numeric(24,10) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  uom_id uuid REFERENCES tenant.units_of_measure(id) ON DELETE SET NULL,
  unit_price numeric(24,10) NOT NULL DEFAULT 0,
  discount_amount numeric(24,6) NOT NULL DEFAULT 0,
  net_amount numeric(24,6) NOT NULL DEFAULT 0,
  tax_amount numeric(24,6) NOT NULL DEFAULT 0,
  withholding_amount numeric(24,6) NOT NULL DEFAULT 0,
  line_total numeric(24,6) NOT NULL DEFAULT 0,
  expense_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  tax_account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  withholding_account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  tax_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, vendor_bill_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_bill_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  due_date date NOT NULL,
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  outstanding_amount numeric(24,6) NOT NULL CHECK (outstanding_amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','overdue','written_off')),
  UNIQUE (organization_id, vendor_bill_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE RESTRICT,
  payment_number text NOT NULL,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  bank_account_id uuid,
  payment_date date NOT NULL,
  accounting_date date NOT NULL,
  currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  base_amount numeric(24,6) NOT NULL CHECK (base_amount > 0),
  unapplied_amount numeric(24,6) NOT NULL CHECK (unapplied_amount >= 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('cash','bank_transfer','card','upi','cheque','gateway','other')),
  external_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','posted','partially_applied','applied','reversed','cancelled')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, payment_number),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES tenant.accounting_vendor_payments(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id) ON DELETE RESTRICT,
  schedule_id uuid REFERENCES tenant.accounting_vendor_bill_schedules(id) ON DELETE SET NULL,
  allocated_amount numeric(24,6) NOT NULL CHECK (allocated_amount > 0),
  realized_gain_loss numeric(24,6) NOT NULL DEFAULT 0,
  discount_taken numeric(24,6) NOT NULL DEFAULT 0 CHECK (discount_taken >= 0),
  writeoff_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (writeoff_amount >= 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, payment_id, vendor_bill_id, schedule_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  gl_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  code text NOT NULL,
  bank_name text NOT NULL,
  account_name text NOT NULL,
  masked_account_number text,
  ifsc_swift text,
  currency_code char(3) NOT NULL,
  account_type text NOT NULL DEFAULT 'current' CHECK (account_type IN ('current','savings','cash','credit_card','loan','virtual','other')),
  statement_import_format text NOT NULL DEFAULT 'csv' CHECK (statement_import_format IN ('csv','ofx','mt940','camt053','api','manual')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code),
  UNIQUE (organization_id, id)
);

ALTER TABLE tenant.accounting_customer_receipts
  DROP CONSTRAINT IF EXISTS accounting_customer_receipts_bank_account_id_fkey,
  ADD CONSTRAINT accounting_customer_receipts_bank_account_id_fkey
    FOREIGN KEY (bank_account_id) REFERENCES tenant.accounting_bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_payments
  DROP CONSTRAINT IF EXISTS accounting_vendor_payments_bank_account_id_fkey,
  ADD CONSTRAINT accounting_vendor_payments_bank_account_id_fkey
    FOREIGN KEY (bank_account_id) REFERENCES tenant.accounting_bank_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant.accounting_bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES tenant.accounting_bank_accounts(id) ON DELETE CASCADE,
  statement_number text NOT NULL,
  statement_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_balance numeric(24,6) NOT NULL,
  closing_balance numeric(24,6) NOT NULL,
  currency_code char(3) NOT NULL,
  import_source text NOT NULL DEFAULT 'manual',
  source_file_name text,
  source_hash text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','imported','reconciling','reconciled','cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  UNIQUE (organization_id, bank_account_id, statement_number),
  UNIQUE (organization_id, bank_account_id, source_hash),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_statement_id uuid NOT NULL REFERENCES tenant.accounting_bank_statements(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  transaction_date date NOT NULL,
  value_date date,
  external_id text,
  reference text,
  description text,
  counterparty_name text,
  counterparty_account text,
  debit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  balance numeric(24,6),
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','suggested','partially_matched','matched','ignored')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  UNIQUE (organization_id, bank_statement_id, sequence),
  UNIQUE (organization_id, bank_statement_id, external_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES tenant.accounting_bank_accounts(id) ON DELETE CASCADE,
  bank_statement_id uuid REFERENCES tenant.accounting_bank_statements(id) ON DELETE SET NULL,
  reconciliation_date date NOT NULL,
  statement_balance numeric(24,6) NOT NULL,
  ledger_balance numeric(24,6) NOT NULL,
  difference numeric(24,6) NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','reopened','cancelled')),
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bank_account_id, reconciliation_date),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reconciliation_id uuid NOT NULL REFERENCES tenant.accounting_reconciliations(id) ON DELETE CASCADE,
  statement_line_id uuid NOT NULL REFERENCES tenant.accounting_bank_statement_lines(id) ON DELETE RESTRICT,
  journal_line_id uuid REFERENCES tenant.accounting_journal_lines(id) ON DELETE RESTRICT,
  match_type text NOT NULL CHECK (match_type IN ('exact','rule','manual','writeoff','fee','interest','transfer')),
  matched_amount numeric(24,6) NOT NULL CHECK (matched_amount > 0),
  confidence numeric(5,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  match_note text,
  matched_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reconciliation_id, statement_line_id, journal_line_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  journal_id uuid NOT NULL REFERENCES tenant.accounting_journals(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','half_yearly','yearly','custom')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  next_run_date date NOT NULL,
  end_date date,
  auto_post boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  currency_code char(3) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR next_run_date <= end_date),
  UNIQUE (organization_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_recurring_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES tenant.accounting_recurring_templates(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  description text,
  debit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  UNIQUE (organization_id, template_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_accrual_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('accrual','deferred_expense','deferred_revenue')),
  source_type text,
  source_id uuid,
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_amount numeric(24,6) NOT NULL CHECK (total_amount > 0),
  recognized_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (recognized_amount >= 0),
  source_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  target_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','yearly','custom')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','completed','cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date),
  CHECK (recognized_amount <= total_amount),
  UNIQUE (organization_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_revaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  run_number text NOT NULL,
  valuation_date date NOT NULL,
  source_currency_code char(3) NOT NULL,
  functional_currency_code char(3) NOT NULL,
  rate numeric(24,10) NOT NULL CHECK (rate > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','posted','reversed','cancelled')),
  gain_total numeric(24,6) NOT NULL DEFAULT 0,
  loss_total numeric(24,6) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  reversal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (organization_id, run_number),
  UNIQUE (organization_id, company_id, ledger_id, valuation_date, source_currency_code)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_revaluation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revaluation_run_id uuid NOT NULL REFERENCES tenant.accounting_revaluation_runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  foreign_balance numeric(24,6) NOT NULL,
  existing_base_balance numeric(24,6) NOT NULL,
  revalued_base_balance numeric(24,6) NOT NULL,
  gain_loss_amount numeric(24,6) NOT NULL,
  UNIQUE (organization_id, revaluation_run_id, account_id, party_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  fiscal_year text NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  scenario text NOT NULL DEFAULT 'budget' CHECK (scenario IN ('budget','forecast','reforecast','plan')),
  currency_code char(3) NOT NULL,
  control_mode text NOT NULL DEFAULT 'warning' CHECK (control_mode IN ('none','warning','block')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','active','superseded','cancelled')),
  approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code, version_number),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES tenant.accounting_budgets(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  period_number integer NOT NULL CHECK (period_number BETWEEN 1 AND 14),
  amount numeric(24,6) NOT NULL,
  committed_amount numeric(24,6) NOT NULL DEFAULT 0,
  consumed_amount numeric(24,6) NOT NULL DEFAULT 0,
  UNIQUE (organization_id, budget_id, account_id, branch_id, department_id, cost_center_id, period_number)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  fiscal_period_id uuid NOT NULL REFERENCES tenant.fiscal_periods(id) ON DELETE RESTRICT,
  run_number text NOT NULL,
  close_type text NOT NULL CHECK (close_type IN ('month','quarter','year','soft','hard')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','completed','reopened','cancelled')),
  completion_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  blocked_reason text,
  started_at timestamptz,
  started_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_number),
  UNIQUE (organization_id, company_id, ledger_id, fiscal_period_id, close_type)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_close_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  close_run_id uuid NOT NULL REFERENCES tenant.accounting_close_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  task_key text NOT NULL,
  name text NOT NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  blocking boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','waived','blocked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, close_run_id, sequence),
  UNIQUE (organization_id, close_run_id, task_key)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_intercompany_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  to_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  due_from_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  due_to_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id) ON DELETE RESTRICT,
  elimination_account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_company_id <> to_company_id),
  UNIQUE (organization_id, from_company_id, to_company_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES tenant.accounting_journal_entries(id) ON DELETE RESTRICT,
  journal_line_id uuid NOT NULL REFERENCES tenant.accounting_journal_lines(id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  tax_registration text,
  tax_type text NOT NULL CHECK (tax_type IN ('cgst','sgst','igst','cess','vat','sales_tax','tds','tcs','withholding','other')),
  direction text NOT NULL CHECK (direction IN ('input','output','withholding')),
  tax_period text NOT NULL,
  taxable_amount numeric(24,6) NOT NULL,
  tax_amount numeric(24,6) NOT NULL,
  recoverable_amount numeric(24,6) NOT NULL DEFAULT 0,
  reverse_charge boolean NOT NULL DEFAULT false,
  place_of_supply text,
  hsn_sac_code text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reported','paid','carried_forward','reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, journal_line_id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounting_events_entity_idx
  ON tenant.accounting_events(organization_id, entity_type, entity_id, occurred_at DESC);

ALTER TABLE tenant.accounting_settings
  DROP CONSTRAINT IF EXISTS accounting_settings_default_ledger_id_fkey,
  ADD CONSTRAINT accounting_settings_default_ledger_id_fkey FOREIGN KEY (default_ledger_id) REFERENCES tenant.accounting_ledgers(id) ON DELETE SET NULL;

DO $$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY ARRAY[
    'retained_earnings_account_id','suspense_account_id','rounding_account_id',
    'realized_gain_account_id','realized_loss_account_id','unrealized_gain_account_id','unrealized_loss_account_id',
    'default_receivable_account_id','default_payable_account_id','default_revenue_account_id','default_expense_account_id',
    'default_output_tax_account_id','default_input_tax_account_id','bank_suspense_account_id','writeoff_account_id'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'tenant.accounting_settings'::regclass
        AND conname = 'accounting_settings_' || column_name || '_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE tenant.accounting_settings ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES tenant.accounting_accounts(id) ON DELETE SET NULL',
        'accounting_settings_' || column_name || '_fkey', column_name
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION tenant.accounting_validate_posted_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total_debit numeric(24,6); total_credit numeric(24,6); line_count integer; period_status text;
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT count(*), COALESCE(sum(base_debit_amount),0), COALESCE(sum(base_credit_amount),0)
      INTO line_count, total_debit, total_credit
    FROM tenant.accounting_journal_lines
    WHERE journal_entry_id = NEW.id AND organization_id = NEW.organization_id;
    IF line_count < 2 THEN RAISE EXCEPTION 'A posted journal entry requires at least two lines'; END IF;
    IF total_debit <> total_credit THEN RAISE EXCEPTION 'Journal entry is not balanced: debit %, credit %', total_debit, total_credit; END IF;
    SELECT status INTO period_status FROM tenant.fiscal_periods
      WHERE id = NEW.fiscal_period_id AND organization_id = NEW.organization_id;
    IF period_status IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Accounting period is not open'; END IF;
    NEW.posted_at = COALESCE(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS accounting_journal_entry_post_guard ON tenant.accounting_journal_entries;
CREATE TRIGGER accounting_journal_entry_post_guard
  BEFORE UPDATE OF status ON tenant.accounting_journal_entries
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_validate_posted_entry();

CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('posted','reversed') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Posted accounting entries cannot be deleted'; END IF;
    IF NEW.status = OLD.status OR NEW.status NOT IN ('reversed') THEN
      RAISE EXCEPTION 'Posted accounting entries are immutable; create a reversal';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS accounting_journal_entry_immutable ON tenant.accounting_journal_entries;
CREATE TRIGGER accounting_journal_entry_immutable
  BEFORE UPDATE OR DELETE ON tenant.accounting_journal_entries
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_protect_posted_entry();

CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM tenant.accounting_journal_entries WHERE id = OLD.journal_entry_id;
  IF parent_status IN ('posted','reversed') THEN RAISE EXCEPTION 'Lines of a posted accounting entry are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS accounting_journal_line_immutable ON tenant.accounting_journal_lines;
CREATE TRIGGER accounting_journal_line_immutable
  BEFORE UPDATE OR DELETE ON tenant.accounting_journal_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_protect_posted_line();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_settings','accounting_ledgers','accounting_accounts','accounting_account_mappings',
    'accounting_dimensions','accounting_dimension_values','accounting_journals','accounting_journal_entries',
    'accounting_journal_lines','accounting_line_dimensions','accounting_posting_rules','accounting_subledger_events',
    'accounting_customer_invoices','accounting_customer_invoice_lines','accounting_customer_invoice_schedules',
    'accounting_customer_receipts','accounting_customer_receipt_allocations','accounting_vendor_bills',
    'accounting_vendor_bill_lines','accounting_vendor_bill_schedules','accounting_vendor_payments',
    'accounting_vendor_payment_allocations','accounting_bank_accounts','accounting_bank_statements',
    'accounting_bank_statement_lines','accounting_reconciliations','accounting_reconciliation_matches',
    'accounting_recurring_templates','accounting_recurring_template_lines','accounting_accrual_schedules',
    'accounting_revaluation_runs','accounting_revaluation_lines','accounting_budgets','accounting_budget_lines',
    'accounting_close_runs','accounting_close_tasks','accounting_intercompany_rules','accounting_tax_ledger','accounting_events'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', table_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT column_catalog.table_name
    FROM information_schema.columns AS column_catalog
    WHERE column_catalog.table_schema = 'tenant'
      AND column_catalog.column_name = 'updated_at'
      AND column_catalog.table_name LIKE 'accounting_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I', table_name || '_touch_updated_at', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()', table_name || '_touch_updated_at', table_name);
  END LOOP;
END $$;

-- Seed a complete but editable operating chart for each company.
WITH company_seed AS (
  SELECT company.id AS company_id, company.organization_id, company.base_currency, organization.created_by
  FROM public.companies company
  JOIN public.organizations organization ON organization.id = company.organization_id
), inserted_ledgers AS (
  INSERT INTO tenant.accounting_ledgers (
    organization_id, company_id, code, name, ledger_type, accounting_standard,
    functional_currency_code, chart_code, created_by, updated_by
  )
  SELECT organization_id, company_id, 'PRIMARY', 'Primary ledger', 'primary', 'local_gaap',
         base_currency, 'OPERATING', created_by, created_by
  FROM company_seed
  ON CONFLICT (organization_id, company_id, code) DO UPDATE SET updated_at = now()
  RETURNING id, organization_id, company_id, functional_currency_code, created_by
)
SELECT 1;

WITH ledger_seed AS (
  SELECT ledger.id AS ledger_id, ledger.organization_id, ledger.company_id, ledger.functional_currency_code,
         organization.created_by
  FROM tenant.accounting_ledgers ledger
  JOIN public.organizations organization ON organization.id = ledger.organization_id
  WHERE ledger.code = 'PRIMARY'
), account_seed(code,name,account_class,account_type,normal_balance,is_group,allow_manual,reconcile) AS (
  VALUES
    ('1000','Assets','asset','group','debit',true,false,false),
    ('1100','Cash and bank','asset','group','debit',true,false,false),
    ('1110','Cash on hand','asset','cash','debit',false,true,true),
    ('1120','Main bank','asset','bank','debit',false,true,true),
    ('1190','Bank suspense','asset','suspense','debit',false,true,true),
    ('1200','Trade receivables','asset','receivable','debit',false,false,true),
    ('1300','Inventory','asset','inventory','debit',false,false,true),
    ('1400','Input tax receivable','asset','tax_input','debit',false,false,true),
    ('1500','Fixed assets','asset','fixed_asset','debit',false,false,true),
    ('1590','Accumulated depreciation','asset','accumulated_depreciation','credit',false,false,true),
    ('1900','Other current assets','asset','current_asset','debit',false,true,false),
    ('2000','Liabilities','liability','group','credit',true,false,false),
    ('2100','Trade payables','liability','payable','credit',false,false,true),
    ('2200','Output tax payable','liability','tax_output','credit',false,false,true),
    ('2300','Withholding taxes payable','liability','tax_output','credit',false,false,true),
    ('2400','Other current liabilities','liability','current_liability','credit',false,true,false),
    ('2500','Long-term liabilities','liability','non_current_liability','credit',false,true,false),
    ('2900','Suspense and clearing','liability','suspense','credit',false,true,true),
    ('3000','Equity','equity','group','credit',true,false,false),
    ('3100','Capital','equity','equity','credit',false,true,false),
    ('3200','Retained earnings','equity','retained_earnings','credit',false,false,false),
    ('4000','Revenue','revenue','group','credit',true,false,false),
    ('4100','Sales revenue','revenue','revenue','credit',false,true,false),
    ('4200','Service revenue','revenue','revenue','credit',false,true,false),
    ('4900','Other income','revenue','other_income','credit',false,true,false),
    ('4950','Purchase discounts and settlement gains','revenue','other_income','credit',false,false,false),
    ('5000','Cost of sales','expense','cogs','debit',false,true,false),
    ('6000','Operating expenses','expense','group','debit',true,false,false),
    ('6100','General expense','expense','expense','debit',false,true,false),
    ('6200','Payroll expense','expense','expense','debit',false,true,false),
    ('6300','Depreciation expense','expense','expense','debit',false,true,false),
    ('6400','Bank charges','expense','expense','debit',false,true,false),
    ('6500','Bad debt and write-off','expense','expense','debit',false,true,false),
    ('6900','Rounding differences','expense','rounding','debit',false,true,false),
    ('7000','Foreign exchange','revenue','group','credit',true,false,false),
    ('7100','Realized FX gain','revenue','fx_gain','credit',false,false,false),
    ('7110','Unrealized FX gain','revenue','fx_gain','credit',false,false,false),
    ('7200','Realized FX loss','expense','fx_loss','debit',false,false,false),
    ('7210','Unrealized FX loss','expense','fx_loss','debit',false,false,false),
    ('8000','Intercompany','asset','group','debit',true,false,false),
    ('8100','Due from related companies','asset','intercompany','debit',false,false,true),
    ('8200','Due to related companies','liability','intercompany','credit',false,false,true)
)
INSERT INTO tenant.accounting_accounts (
  organization_id, company_id, ledger_id, code, name, account_class, account_type,
  normal_balance, is_group, allow_manual_posting, reconciliation_required, created_by, updated_by
)
SELECT ledger.organization_id, ledger.company_id, ledger.ledger_id, seed.code, seed.name, seed.account_class,
       seed.account_type, seed.normal_balance, seed.is_group, seed.allow_manual, seed.reconcile,
       ledger.created_by, ledger.created_by
FROM ledger_seed ledger CROSS JOIN account_seed seed
ON CONFLICT (organization_id, company_id, ledger_id, code) DO NOTHING;

UPDATE tenant.accounting_accounts child
SET parent_id = parent.id
FROM tenant.accounting_accounts parent
WHERE child.organization_id = parent.organization_id
  AND child.company_id = parent.company_id
  AND child.ledger_id = parent.ledger_id
  AND child.parent_id IS NULL
  AND child.code <> parent.code
  AND (
    (child.code LIKE '1%' AND parent.code = '1000') OR
    (child.code LIKE '11%' AND child.code <> '1100' AND parent.code = '1100') OR
    (child.code LIKE '2%' AND parent.code = '2000') OR
    (child.code LIKE '3%' AND parent.code = '3000') OR
    (child.code LIKE '4%' AND parent.code = '4000') OR
    (child.code LIKE '6%' AND child.code <> '6000' AND parent.code = '6000') OR
    (child.code LIKE '7%' AND child.code <> '7000' AND parent.code = '7000') OR
    (child.code LIKE '8%' AND child.code <> '8000' AND parent.code = '8000')
  );

WITH ledger_seed AS (
  SELECT ledger.id AS ledger_id, ledger.organization_id, ledger.company_id, organization.created_by
  FROM tenant.accounting_ledgers ledger
  JOIN public.organizations organization ON organization.id = ledger.organization_id
  WHERE ledger.code='PRIMARY'
), journal_seed(code,name,journal_type,debit_code,credit_code,approval_required) AS (
  VALUES
    ('GEN','General journal','general',NULL,NULL,true),
    ('SAL','Sales journal','sales','1200','4100',false),
    ('PUR','Purchase journal','purchase','6100','2100',false),
    ('BNK','Bank journal','bank','1120','1190',false),
    ('CSH','Cash journal','cash','1110','2900',false),
    ('TAX','Tax journal','tax','1400','2200',true),
    ('AST','Asset journal','asset','1500','1590',true),
    ('CLS','Closing journal','closing',NULL,NULL,true),
    ('IC','Intercompany journal','intercompany','8100','8200',true)
)
INSERT INTO tenant.accounting_journals (
  organization_id, company_id, ledger_id, code, name, journal_type,
  default_debit_account_id, default_credit_account_id, approval_required, created_by, updated_by
)
SELECT ledger.organization_id, ledger.company_id, ledger.ledger_id, seed.code, seed.name, seed.journal_type,
       debit_account.id, credit_account.id, seed.approval_required, ledger.created_by, ledger.created_by
FROM ledger_seed ledger
CROSS JOIN journal_seed seed
LEFT JOIN tenant.accounting_accounts debit_account
  ON debit_account.organization_id=ledger.organization_id AND debit_account.company_id=ledger.company_id
 AND debit_account.ledger_id=ledger.ledger_id AND debit_account.code=seed.debit_code
LEFT JOIN tenant.accounting_accounts credit_account
  ON credit_account.organization_id=ledger.organization_id AND credit_account.company_id=ledger.company_id
 AND credit_account.ledger_id=ledger.ledger_id AND credit_account.code=seed.credit_code
ON CONFLICT (organization_id, company_id, code) DO NOTHING;

WITH mapping_seed(mapping_key,account_code) AS (
  VALUES
    ('receivable','1200'),('payable','2100'),('revenue','4100'),('service_revenue','4200'),
    ('expense','6100'),('cogs','5000'),('input_tax','1400'),('output_tax','2200'),
    ('withholding_tax','2300'),('cash','1110'),('bank','1120'),('bank_suspense','1190'),
    ('suspense','2900'),('rounding','6900'),('writeoff','6500'),('purchase_discount','4950'),('retained_earnings','3200'),
    ('realized_fx_gain','7100'),('unrealized_fx_gain','7110'),('realized_fx_loss','7200'),
    ('unrealized_fx_loss','7210'),('due_from','8100'),('due_to','8200')
)
INSERT INTO tenant.accounting_account_mappings (
  organization_id, company_id, ledger_id, mapping_key, account_id, priority, created_by, updated_by
)
SELECT ledger.organization_id, ledger.company_id, ledger.id, seed.mapping_key, account.id, 100,
       organization.created_by, organization.created_by
FROM tenant.accounting_ledgers ledger
JOIN public.organizations organization ON organization.id=ledger.organization_id
CROSS JOIN mapping_seed seed
JOIN tenant.accounting_accounts account
  ON account.organization_id=ledger.organization_id AND account.company_id=ledger.company_id
 AND account.ledger_id=ledger.id AND account.code=seed.account_code
WHERE ledger.code='PRIMARY'
ON CONFLICT DO NOTHING;

INSERT INTO tenant.accounting_settings (
  organization_id, company_id, default_ledger_id, retained_earnings_account_id, suspense_account_id,
  rounding_account_id, realized_gain_account_id, realized_loss_account_id,
  unrealized_gain_account_id, unrealized_loss_account_id, default_receivable_account_id,
  default_payable_account_id, default_revenue_account_id, default_expense_account_id,
  default_output_tax_account_id, default_input_tax_account_id, bank_suspense_account_id,
  writeoff_account_id, created_by, updated_by
)
SELECT organization.id, company.id, ledger.id,
  retained.id, suspense.id, rounding.id, rgain.id, rloss.id, ugain.id, uloss.id,
  receivable.id, payable.id, revenue.id, expense.id, output_tax.id, input_tax.id,
  bank_suspense.id, writeoff.id, organization.created_by, organization.created_by
FROM public.organizations organization
JOIN public.companies company ON company.organization_id=organization.id
JOIN tenant.accounting_ledgers ledger ON ledger.organization_id=organization.id AND ledger.company_id=company.id AND ledger.code='PRIMARY'
LEFT JOIN tenant.accounting_accounts retained ON retained.ledger_id=ledger.id AND retained.code='3200'
LEFT JOIN tenant.accounting_accounts suspense ON suspense.ledger_id=ledger.id AND suspense.code='2900'
LEFT JOIN tenant.accounting_accounts rounding ON rounding.ledger_id=ledger.id AND rounding.code='6900'
LEFT JOIN tenant.accounting_accounts rgain ON rgain.ledger_id=ledger.id AND rgain.code='7100'
LEFT JOIN tenant.accounting_accounts rloss ON rloss.ledger_id=ledger.id AND rloss.code='7200'
LEFT JOIN tenant.accounting_accounts ugain ON ugain.ledger_id=ledger.id AND ugain.code='7110'
LEFT JOIN tenant.accounting_accounts uloss ON uloss.ledger_id=ledger.id AND uloss.code='7210'
LEFT JOIN tenant.accounting_accounts receivable ON receivable.ledger_id=ledger.id AND receivable.code='1200'
LEFT JOIN tenant.accounting_accounts payable ON payable.ledger_id=ledger.id AND payable.code='2100'
LEFT JOIN tenant.accounting_accounts revenue ON revenue.ledger_id=ledger.id AND revenue.code='4100'
LEFT JOIN tenant.accounting_accounts expense ON expense.ledger_id=ledger.id AND expense.code='6100'
LEFT JOIN tenant.accounting_accounts output_tax ON output_tax.ledger_id=ledger.id AND output_tax.code='2200'
LEFT JOIN tenant.accounting_accounts input_tax ON input_tax.ledger_id=ledger.id AND input_tax.code='1400'
LEFT JOIN tenant.accounting_accounts bank_suspense ON bank_suspense.ledger_id=ledger.id AND bank_suspense.code='1190'
LEFT JOIN tenant.accounting_accounts writeoff ON writeoff.ledger_id=ledger.id AND writeoff.code='6500'
ON CONFLICT (organization_id, company_id) DO NOTHING;

COMMIT;
