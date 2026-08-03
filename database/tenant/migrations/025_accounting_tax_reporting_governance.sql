BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_tax_returns_organization_id_id_uidx
  ON tenant.accounting_tax_returns(organization_id, id);

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_reporting_policies (
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  filing_warning_days integer NOT NULL DEFAULT 7
    CHECK (filing_warning_days >= 0),
  exception_escalation_days integer NOT NULL DEFAULT 3
    CHECK (exception_escalation_days > 0),
  reporting_tolerance numeric(24,6) NOT NULL DEFAULT 0.01
    CHECK (reporting_tolerance >= 0),
  require_tax_registration boolean NOT NULL DEFAULT true,
  require_external_reference boolean NOT NULL DEFAULT true,
  block_open_exceptions boolean NOT NULL DEFAULT true,
  block_failed_compliance boolean NOT NULL DEFAULT true,
  require_subledger_reconciliation boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_saved_views (
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

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  tax_return_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'under_review', 'waiting_documents', 'provider_query',
      'resolved', 'closed'
    )),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reason_code text NOT NULL DEFAULT 'other'
    CHECK (reason_code IN (
      'missing_registration', 'ledger_mismatch', 'ineligible_itc',
      'missing_hsn_sac', 'place_of_supply', 'reverse_charge',
      'filing_reference', 'compliance_failure', 'subledger_mismatch',
      'other'
    )),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (organization_id, tax_return_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, tax_return_id)
    REFERENCES tenant.accounting_tax_returns(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_tax_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  tax_return_id uuid NOT NULL,
  return_status text NOT NULL,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'attention', 'blocked')),
  risk_band text NOT NULL
    CHECK (risk_band IN ('low', 'medium', 'high')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, tax_return_id)
    REFERENCES tenant.accounting_tax_returns(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_financial_reporting_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  fiscal_period_id uuid,
  report_type text NOT NULL
    CHECK (report_type IN (
      'trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-flow',
      'tax-summary', 'subledger-reconciliation', 'close-pack'
    )),
  as_of_date date NOT NULL DEFAULT current_date,
  readiness_status text NOT NULL DEFAULT 'captured'
    CHECK (readiness_status IN ('captured', 'attention', 'blocked')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, fiscal_period_id)
    REFERENCES tenant.fiscal_periods(organization_id, id)
    ON DELETE SET NULL (fiscal_period_id)
);

CREATE INDEX IF NOT EXISTS accounting_tax_saved_views_owner_idx
  ON tenant.accounting_tax_saved_views(
    organization_id, owner_user_id, is_shared, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_tax_exception_cases_queue_idx
  ON tenant.accounting_tax_exception_cases(
    organization_id, company_id, status, priority, next_action_at
  )
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS accounting_tax_governance_snapshots_return_idx
  ON tenant.accounting_tax_governance_snapshots(
    organization_id, tax_return_id, captured_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_financial_reporting_snapshots_company_idx
  ON tenant.accounting_financial_reporting_snapshots(
    organization_id, company_id, report_type, captured_at DESC
  );

INSERT INTO tenant.accounting_tax_reporting_policies (
  organization_id,
  company_id,
  created_by,
  updated_by
)
SELECT
  company.organization_id,
  company.id,
  organization.created_by,
  organization.created_by
FROM public.companies company
JOIN public.organizations organization
  ON organization.id=company.organization_id
ON CONFLICT (organization_id, company_id) DO NOTHING;

ALTER TABLE tenant.accounting_tax_reporting_policies
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_reporting_policies
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_saved_views
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_saved_views
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_exception_cases
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_exception_cases
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_governance_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_tax_governance_snapshots
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_financial_reporting_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_financial_reporting_snapshots
  FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_tax_reporting_policies',
    'accounting_tax_saved_views',
    'accounting_tax_exception_cases',
    'accounting_tax_governance_snapshots',
    'accounting_financial_reporting_snapshots'
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
