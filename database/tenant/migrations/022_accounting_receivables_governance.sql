BEGIN;

CREATE TABLE IF NOT EXISTS tenant.accounting_receivables_governance_policies (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  approval_sla_hours integer NOT NULL DEFAULT 24
    CHECK (approval_sla_hours BETWEEN 1 AND 8760),
  due_soon_days integer NOT NULL DEFAULT 7
    CHECK (due_soon_days BETWEEN 1 AND 365),
  stale_after_days integer NOT NULL DEFAULT 14
    CHECK (stale_after_days BETWEEN 1 AND 3650),
  collection_start_days integer NOT NULL DEFAULT 1
    CHECK (collection_start_days BETWEEN 0 AND 3650),
  escalation_days integer NOT NULL DEFAULT 30
    CHECK (escalation_days BETWEEN 1 AND 3650),
  high_risk_days integer NOT NULL DEFAULT 60
    CHECK (high_risk_days BETWEEN 1 AND 3650),
  require_billing_address boolean NOT NULL DEFAULT true,
  require_payment_terms boolean NOT NULL DEFAULT true,
  require_payment_schedule boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (escalation_days <= high_risk_days)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_receivables_saved_views (
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

CREATE TABLE IF NOT EXISTS tenant.accounting_receivables_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_invoice_id uuid NOT NULL,
  invoice_type text NOT NULL,
  invoice_status text NOT NULL,
  outstanding_amount numeric(24,6) NOT NULL DEFAULT 0,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'attention', 'blocked')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, customer_invoice_id)
    REFERENCES tenant.accounting_customer_invoices(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_collection_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_invoice_id uuid NOT NULL,
  company_id uuid NOT NULL,
  party_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'promise_to_pay', 'disputed', 'escalated', 'resolved', 'closed'
    )),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  promised_date date,
  promised_amount numeric(24,6)
    CHECK (promised_amount IS NULL OR promised_amount >= 0),
  dispute_reason text,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (organization_id, customer_invoice_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, customer_invoice_id)
    REFERENCES tenant.accounting_customer_invoices(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, party_id)
    REFERENCES tenant.business_parties(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS accounting_receivables_saved_views_owner_idx
  ON tenant.accounting_receivables_saved_views(
    organization_id, owner_user_id, is_shared, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_receivables_governance_snapshots_invoice_idx
  ON tenant.accounting_receivables_governance_snapshots(
    organization_id, customer_invoice_id, captured_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_collection_cases_queue_idx
  ON tenant.accounting_collection_cases(
    organization_id, status, priority, next_action_at
  )
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS accounting_collection_cases_party_idx
  ON tenant.accounting_collection_cases(
    organization_id, party_id, status, updated_at DESC
  );

INSERT INTO tenant.accounting_receivables_governance_policies (
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

ALTER TABLE tenant.accounting_receivables_governance_policies
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_receivables_governance_policies
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_receivables_saved_views
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_receivables_saved_views
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_receivables_governance_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_receivables_governance_snapshots
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_collection_cases
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_collection_cases
  FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_receivables_governance_policies',
    'accounting_receivables_saved_views',
    'accounting_receivables_governance_snapshots',
    'accounting_collection_cases'
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
