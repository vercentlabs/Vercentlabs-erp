BEGIN;

CREATE TABLE IF NOT EXISTS tenant.accounting_banking_governance_policies (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_sla_hours integer NOT NULL DEFAULT 24 CHECK (import_sla_hours > 0),
  reconciliation_sla_days integer NOT NULL DEFAULT 5
    CHECK (reconciliation_sla_days > 0),
  stale_after_days integer NOT NULL DEFAULT 7 CHECK (stale_after_days > 0),
  exception_escalation_days integer NOT NULL DEFAULT 3
    CHECK (exception_escalation_days > 0),
  high_risk_unmatched_days integer NOT NULL DEFAULT 30
    CHECK (high_risk_unmatched_days > 0),
  close_lookback_days integer NOT NULL DEFAULT 31
    CHECK (close_lookback_days > 0),
  cash_forecast_horizon_days integer NOT NULL DEFAULT 30
    CHECK (cash_forecast_horizon_days > 0),
  require_source_hash boolean NOT NULL DEFAULT true,
  require_completed_reconciliation boolean NOT NULL DEFAULT true,
  block_balance_difference boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (exception_escalation_days <= high_risk_unmatched_days)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_banking_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, owner_user_id, name),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_banking_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_statement_id uuid NOT NULL,
  statement_status text NOT NULL,
  reconciliation_status text,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'attention', 'blocked')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, bank_statement_id)
    REFERENCES tenant.accounting_bank_statements(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_reconciliation_exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_statement_id uuid NOT NULL,
  reconciliation_id uuid,
  company_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'under_review', 'bank_query', 'approved_adjustment',
      'resolved', 'closed'
    )),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reason_code text NOT NULL DEFAULT 'other'
    CHECK (reason_code IN (
      'unmatched_transaction', 'partial_match', 'duplicate_transaction',
      'balance_difference', 'missing_reference', 'bank_charge', 'interest',
      'timing_difference', 'other'
    )),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (organization_id, bank_statement_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, bank_statement_id)
    REFERENCES tenant.accounting_bank_statements(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, reconciliation_id)
    REFERENCES tenant.accounting_reconciliations(organization_id, id)
    ON DELETE SET NULL (reconciliation_id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, bank_account_id)
    REFERENCES tenant.accounting_bank_accounts(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_cash_position_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  as_of timestamptz NOT NULL DEFAULT now(),
  base_currency_code char(3) NOT NULL,
  total_base_balance numeric(24,6) NOT NULL DEFAULT 0,
  balances jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_close_readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  fiscal_period_id uuid NOT NULL,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'blocked')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  banking_blocker_count integer NOT NULL DEFAULT 0
    CHECK (banking_blocker_count >= 0),
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, fiscal_period_id)
    REFERENCES tenant.fiscal_periods(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS accounting_banking_saved_views_owner_idx
  ON tenant.accounting_banking_saved_views(
    organization_id, owner_user_id, is_shared, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_banking_governance_snapshots_statement_idx
  ON tenant.accounting_banking_governance_snapshots(
    organization_id, bank_statement_id, captured_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_reconciliation_exception_cases_queue_idx
  ON tenant.accounting_reconciliation_exception_cases(
    organization_id, status, priority, next_action_at
  )
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS accounting_cash_position_snapshots_company_idx
  ON tenant.accounting_cash_position_snapshots(
    organization_id, company_id, as_of DESC
  );

CREATE INDEX IF NOT EXISTS accounting_close_readiness_snapshots_period_idx
  ON tenant.accounting_close_readiness_snapshots(
    organization_id, fiscal_period_id, captured_at DESC
  );

INSERT INTO tenant.accounting_banking_governance_policies (
  organization_id,
  created_by,
  updated_by
)
SELECT
  organization.id,
  organization.created_by,
  organization.created_by
FROM public.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

ALTER TABLE tenant.accounting_banking_governance_policies
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_banking_governance_policies
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_banking_saved_views
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_banking_saved_views
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_banking_governance_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_banking_governance_snapshots
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_reconciliation_exception_cases
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_reconciliation_exception_cases
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_cash_position_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_cash_position_snapshots
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_close_readiness_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_close_readiness_snapshots
  FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_banking_governance_policies',
    'accounting_banking_saved_views',
    'accounting_banking_governance_snapshots',
    'accounting_reconciliation_exception_cases',
    'accounting_cash_position_snapshots',
    'accounting_close_readiness_snapshots'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I
       USING (
         organization_id =
         current_setting(''app.current_organization_id'', true)::uuid
       )
       WITH CHECK (
         organization_id =
         current_setting(''app.current_organization_id'', true)::uuid
       )',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
