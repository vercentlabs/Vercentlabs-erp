-- Finance MVP, unit F1 — Foundation: fiscal years with monthly periods, a protected Chart of Accounts and the full Indian chart.
--
-- 1. Fiscal years. A company's financial year is a record of its own (FY 2026-27, 1 Apr → 31 Mar) holding its accounting periods.
--    A period's status keeps its stored values; 'soft_closed' is shown as "Closing review" (OPEN → CLOSING_REVIEW → CLOSED → LOCKED).
-- 2. Monthly periods. Companies were given one period for the whole year; an unused one is replaced by twelve monthly periods (a period
--    already referenced by a journal, depreciation, payroll or close run is kept as it is, under its fiscal year).
-- 3. Control accounts. accounting_accounts.control_kind marks the accounts a sub-ledger owns (receivable, payable, bank, cash,
--    inventory, tax, payroll): they take postings only from their source documents, never from a manual journal.
-- 4. History protection. An account with postings cannot be deleted, become a group, or change class, normal balance or ledger; a
--    parent must be a group of the same class and ledger, and the hierarchy has no cycles.
-- 5. The Indian chart's missing accounts: salary, TDS, EPF, ESI and professional tax payables, salaries and employer contributions,
--    rent, utilities, repairs, marketing, and gain or loss on disposal of assets — with their mapping keys.
-- 6. Permission accounting.chart.manage (change the Chart of Accounts), granted to Finance Manager, the owner and system administrators.

-- ============================================================ 1. fiscal years
CREATE TABLE IF NOT EXISTS tenant.accounting_fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by uuid REFERENCES public.users(id),
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_fiscal_years_dates_check CHECK (start_date < end_date),
  CONSTRAINT accounting_fiscal_years_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT accounting_fiscal_years_org_code_key UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS accounting_fiscal_years_org_dates_idx ON tenant.accounting_fiscal_years (organization_id, start_date);

-- Two fiscal years of a company never overlap.
CREATE OR REPLACE FUNCTION tenant.accounting_fiscal_years_no_overlap() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant.accounting_fiscal_years other
              WHERE other.organization_id = NEW.organization_id AND other.id <> NEW.id
                AND daterange(other.start_date, other.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')) THEN
    RAISE EXCEPTION 'This financial year overlaps another one.' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_fiscal_years_no_overlap ON tenant.accounting_fiscal_years;
CREATE TRIGGER accounting_fiscal_years_no_overlap BEFORE INSERT OR UPDATE OF start_date, end_date ON tenant.accounting_fiscal_years
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_fiscal_years_no_overlap();

ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS fiscal_year_id uuid REFERENCES tenant.accounting_fiscal_years(id);
CREATE INDEX IF NOT EXISTS fiscal_periods_fiscal_year_idx ON tenant.fiscal_periods (fiscal_year_id, start_date);

DO $$
BEGIN
  ALTER TABLE tenant.accounting_fiscal_years ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.accounting_fiscal_years FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'accounting_fiscal_years' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.accounting_fiscal_years
      USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_fiscal_years TO vercent_app, vercent_worker;

-- ============================================================ 2. existing periods → fiscal years (+ monthly periods where unused)
-- A fiscal year for every period's year (its earliest start to its latest end).
INSERT INTO tenant.accounting_fiscal_years (organization_id, code, name, start_date, end_date, created_by, updated_by)
SELECT period.organization_id, 'FY' || to_char(min(period.start_date), 'YYYY') || '-' || to_char(max(period.end_date), 'YY'),
       'FY ' || to_char(min(period.start_date), 'YYYY') || '-' || to_char(max(period.end_date), 'YY'),
       min(period.start_date), max(period.end_date), min(period.created_by::text)::uuid, min(period.created_by::text)::uuid
  FROM tenant.fiscal_periods period
 WHERE period.fiscal_year_id IS NULL
 GROUP BY period.organization_id, period.fiscal_year
ON CONFLICT (organization_id, code) DO NOTHING;

UPDATE tenant.fiscal_periods period SET fiscal_year_id = year.id
  FROM tenant.accounting_fiscal_years year
 WHERE period.fiscal_year_id IS NULL AND year.organization_id = period.organization_id
   AND period.start_date BETWEEN year.start_date AND year.end_date;

-- A year-long period nothing refers to becomes twelve monthly periods.
CREATE TEMP TABLE accounting_f1_unused_periods ON COMMIT DROP AS
SELECT period.id, period.organization_id, period.fiscal_year_id, period.fiscal_year, period.start_date, period.end_date, period.status, period.created_by
  FROM tenant.fiscal_periods period
 WHERE period.end_date - period.start_date > 40 AND period.period_type IS DISTINCT FROM 'adjustment'
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_journal_entries entry WHERE entry.fiscal_period_id = period.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_close_runs run WHERE run.fiscal_period_id = period.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_close_readiness_snapshots snapshot WHERE snapshot.fiscal_period_id = period.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_financial_reporting_snapshots snapshot WHERE snapshot.fiscal_period_id = period.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_asset_depreciation_schedule line WHERE line.fiscal_period_id = period.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_period_runs run WHERE run.fiscal_period_id = period.id);

DELETE FROM tenant.fiscal_periods period USING accounting_f1_unused_periods unused WHERE period.id = unused.id;

INSERT INTO tenant.fiscal_periods (organization_id, name, fiscal_year, fiscal_year_id, start_date, end_date, period_number, period_type, status, created_by, updated_by)
SELECT unused.organization_id, to_char(month_start, 'Mon YYYY'), unused.fiscal_year, unused.fiscal_year_id,
       month_start::date, (month_start + interval '1 month - 1 day')::date, row_number() OVER (PARTITION BY unused.id ORDER BY month_start)::int,
       'standard', 'open', unused.created_by, unused.created_by
  FROM accounting_f1_unused_periods unused
  CROSS JOIN LATERAL generate_series(unused.start_date::timestamp, unused.end_date::timestamp, interval '1 month') AS month_start
ON CONFLICT (organization_id, start_date, end_date) DO NOTHING;

-- ============================================================ 3. control accounts
ALTER TABLE tenant.accounting_accounts ADD COLUMN IF NOT EXISTS control_kind text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_accounts_control_kind_check') THEN
    ALTER TABLE tenant.accounting_accounts ADD CONSTRAINT accounting_accounts_control_kind_check
      CHECK (control_kind IS NULL OR control_kind IN ('receivable', 'payable', 'bank', 'cash', 'inventory', 'tax', 'payroll'));
  END IF;
END $$;
UPDATE tenant.accounting_accounts SET control_kind = CASE account_type
    WHEN 'receivable' THEN 'receivable' WHEN 'payable' THEN 'payable' WHEN 'bank' THEN 'bank' WHEN 'cash' THEN 'cash'
    WHEN 'inventory' THEN 'inventory' WHEN 'tax_input' THEN 'tax' WHEN 'tax_output' THEN 'tax' END
 WHERE control_kind IS NULL AND NOT is_group AND account_type IN ('receivable', 'payable', 'bank', 'cash', 'inventory', 'tax_input', 'tax_output');

-- ============================================================ 4. history protection
-- The seeded chart filed the FX loss accounts (expense) under the Foreign exchange group (revenue): they become top-level expense
-- accounts, so every account sits under a group of its own class before the rule below applies.
UPDATE tenant.accounting_accounts child SET parent_id = NULL
  FROM tenant.accounting_accounts parent
 WHERE parent.id = child.parent_id AND (parent.account_class <> child.account_class OR NOT parent.is_group OR parent.ledger_id <> child.ledger_id);

CREATE OR REPLACE FUNCTION tenant.accounting_accounts_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  has_postings boolean;
  parent tenant.accounting_accounts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM tenant.accounting_journal_lines line WHERE line.account_id = OLD.id) THEN
      RAISE EXCEPTION 'Account % has postings and cannot be deleted. Deactivate it instead.', OLD.code USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM tenant.accounting_accounts WHERE id = NEW.parent_id;
    IF parent.id IS NULL OR NOT parent.is_group OR parent.account_class <> NEW.account_class OR parent.ledger_id <> NEW.ledger_id
       OR parent.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'The parent of % must be a group account of the same class and ledger.', NEW.code USING ERRCODE = '23514';
    END IF;
    IF EXISTS (WITH RECURSIVE chain AS (
                 SELECT id, parent_id FROM tenant.accounting_accounts WHERE id = NEW.parent_id
                 UNION ALL SELECT account.id, account.parent_id FROM tenant.accounting_accounts account JOIN chain ON account.id = chain.parent_id)
               SELECT 1 FROM chain WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'Account % cannot sit under one of its own sub-accounts.', NEW.code USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.account_class, NEW.normal_balance, NEW.ledger_id, NEW.is_group)
                       IS DISTINCT FROM (OLD.account_class, OLD.normal_balance, OLD.ledger_id, OLD.is_group) THEN
    has_postings := EXISTS (SELECT 1 FROM tenant.accounting_journal_lines line WHERE line.account_id = OLD.id);
    IF has_postings THEN
      RAISE EXCEPTION 'Account % has postings: its class, normal balance, ledger and group setting can no longer change.', OLD.code USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_accounts_guard ON tenant.accounting_accounts;
CREATE TRIGGER accounting_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.accounting_accounts
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_accounts_guard();

-- ============================================================ 5. the Indian chart's missing accounts and their mappings
CREATE TEMP TABLE accounting_f1_accounts (code text, name text, account_class text, account_type text, normal_balance text, allow_manual boolean,
  control_kind text, parent_code text, mapping_key text) ON COMMIT DROP;
INSERT INTO accounting_f1_accounts VALUES
  ('2310', 'Salaries payable', 'liability', 'current_liability', 'credit', false, 'payroll', '2000', 'salary_payable'),
  ('2320', 'TDS payable', 'liability', 'current_liability', 'credit', false, 'payroll', '2000', 'tds_payable'),
  ('2330', 'EPF payable', 'liability', 'current_liability', 'credit', false, 'payroll', '2000', 'epf_payable'),
  ('2340', 'ESI payable', 'liability', 'current_liability', 'credit', false, 'payroll', '2000', 'esi_payable'),
  ('2350', 'Professional tax payable', 'liability', 'current_liability', 'credit', false, 'payroll', '2000', 'pt_payable'),
  ('4970', 'Gain on disposal of assets', 'revenue', 'other_income', 'credit', true, NULL, '4000', 'asset_disposal_gain'),
  ('6210', 'Salaries and wages', 'expense', 'expense', 'debit', true, NULL, '6000', 'salary_expense'),
  ('6220', 'Employer statutory contributions', 'expense', 'expense', 'debit', true, NULL, '6000', 'employer_contribution_expense'),
  ('6570', 'Loss on disposal of assets', 'expense', 'other_expense', 'debit', true, NULL, '6000', 'asset_disposal_loss'),
  ('6600', 'Rent', 'expense', 'expense', 'debit', true, NULL, '6000', NULL),
  ('6610', 'Utilities', 'expense', 'expense', 'debit', true, NULL, '6000', NULL),
  ('6620', 'Repairs and maintenance', 'expense', 'expense', 'debit', true, NULL, '6000', NULL),
  ('6630', 'Marketing and advertising', 'expense', 'expense', 'debit', true, NULL, '6000', NULL);

INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
  allow_manual_posting, reconciliation_required, control_kind, status, created_by, updated_by)
SELECT ledger.organization_id, ledger.id, parent.id, seed.code, seed.name, seed.account_class, seed.account_type, seed.normal_balance, false,
       seed.allow_manual, seed.control_kind IS NOT NULL, seed.control_kind, 'active', ledger.created_by, ledger.created_by
  FROM tenant.accounting_ledgers ledger
  CROSS JOIN accounting_f1_accounts seed
  LEFT JOIN tenant.accounting_accounts parent ON parent.organization_id = ledger.organization_id AND parent.ledger_id = ledger.id
       AND parent.code = seed.parent_code AND parent.is_group AND parent.account_class = seed.account_class
 WHERE ledger.code = 'PRIMARY'
ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;

INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status, created_by, updated_by)
SELECT account.organization_id, account.ledger_id, seed.mapping_key, account.id, 1000, 'active', account.created_by, account.created_by
  FROM accounting_f1_accounts seed
  JOIN tenant.accounting_accounts account ON account.code = seed.code
  JOIN tenant.accounting_ledgers ledger ON ledger.id = account.ledger_id AND ledger.code = 'PRIMARY'
 WHERE seed.mapping_key IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings existing
                    WHERE existing.organization_id = account.organization_id AND existing.ledger_id = account.ledger_id
                      AND existing.mapping_key = seed.mapping_key AND existing.priority = 1000);

-- ============================================================ 6. permission
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('accounting.chart.manage', 'Manage the chart of accounts', 'Accounting', 'Add, change, move and deactivate accounts in the Chart of Accounts.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'accounting.chart.manage' FROM public.roles role
 WHERE role.slug IN ('finance_manager', 'organization_owner', 'system_administrator')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0196_accounting_foundation.sql', 'accounting-foundation') ON CONFLICT DO NOTHING;
