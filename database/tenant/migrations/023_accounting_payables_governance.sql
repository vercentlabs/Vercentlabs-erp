BEGIN;

CREATE TABLE IF NOT EXISTS tenant.accounting_payables_governance_policies (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  approval_sla_hours integer NOT NULL DEFAULT 24
    CHECK (approval_sla_hours BETWEEN 1 AND 8760),
  due_soon_days integer NOT NULL DEFAULT 7
    CHECK (due_soon_days BETWEEN 1 AND 365),
  stale_after_days integer NOT NULL DEFAULT 14
    CHECK (stale_after_days BETWEEN 1 AND 3650),
  exception_escalation_days integer NOT NULL DEFAULT 7
    CHECK (exception_escalation_days BETWEEN 1 AND 3650),
  payment_horizon_days integer NOT NULL DEFAULT 14
    CHECK (payment_horizon_days BETWEEN 0 AND 365),
  high_risk_days integer NOT NULL DEFAULT 60
    CHECK (high_risk_days BETWEEN 1 AND 3650),
  require_supplier_invoice_number boolean NOT NULL DEFAULT true,
  block_duplicate_supplier_invoice boolean NOT NULL DEFAULT true,
  require_matching_for_sourced_bills boolean NOT NULL DEFAULT true,
  require_payment_schedule boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (exception_escalation_days <= high_risk_days)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_payables_saved_views (
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

CREATE TABLE IF NOT EXISTS tenant.accounting_payables_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  bill_type text NOT NULL,
  bill_status text NOT NULL,
  matching_status text NOT NULL,
  outstanding_amount numeric(24,6) NOT NULL DEFAULT 0,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'attention', 'blocked')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, vendor_bill_id)
    REFERENCES tenant.accounting_vendor_bills(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_payables_exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  company_id uuid NOT NULL,
  party_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'under_review', 'supplier_query', 'approved_override',
      'resolved', 'closed'
    )),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reason_code text NOT NULL DEFAULT 'other'
    CHECK (reason_code IN (
      'duplicate_invoice', 'amount_variance', 'quantity_variance',
      'missing_receipt', 'missing_purchase_order', 'tax_variance',
      'supplier_dispute', 'payment_hold', 'other'
    )),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (organization_id, vendor_bill_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, vendor_bill_id)
    REFERENCES tenant.accounting_vendor_bills(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, party_id)
    REFERENCES tenant.business_parties(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_payment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  proposal_code text NOT NULL,
  payment_date date NOT NULL,
  currency_code char(3) NOT NULL,
  bank_account_id uuid REFERENCES tenant.accounting_bank_accounts(id)
    ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'submitted', 'approved', 'rejected', 'prepared', 'cancelled'
    )),
  total_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  notes text,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  prepared_at timestamptz,
  prepared_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, proposal_code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES public.companies(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_payment_proposal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  vendor_bill_id uuid NOT NULL,
  schedule_id uuid,
  proposed_amount numeric(24,6) NOT NULL CHECK (proposed_amount > 0),
  discount_taken numeric(24,6) NOT NULL DEFAULT 0 CHECK (discount_taken >= 0),
  status text NOT NULL DEFAULT 'selected'
    CHECK (status IN ('selected', 'excluded', 'prepared')),
  selection_reason text,
  vendor_payment_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, proposal_id)
    REFERENCES tenant.accounting_vendor_payment_proposals(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, vendor_bill_id)
    REFERENCES tenant.accounting_vendor_bills(organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, schedule_id)
    REFERENCES tenant.accounting_vendor_bill_schedules(organization_id, id)
    ON DELETE SET NULL,
  FOREIGN KEY (organization_id, vendor_payment_id)
    REFERENCES tenant.accounting_vendor_payments(organization_id, id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_payment_proposal_item_identity_uidx
  ON tenant.accounting_vendor_payment_proposal_items(
    organization_id,
    proposal_id,
    vendor_bill_id,
    COALESCE(schedule_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS accounting_payables_saved_views_owner_idx
  ON tenant.accounting_payables_saved_views(
    organization_id, owner_user_id, is_shared, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_payables_governance_snapshots_bill_idx
  ON tenant.accounting_payables_governance_snapshots(
    organization_id, vendor_bill_id, captured_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_payables_exception_cases_queue_idx
  ON tenant.accounting_payables_exception_cases(
    organization_id, status, priority, next_action_at
  )
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS accounting_vendor_payment_proposals_queue_idx
  ON tenant.accounting_vendor_payment_proposals(
    organization_id, status, payment_date, created_at DESC
  );

CREATE INDEX IF NOT EXISTS accounting_vendor_payment_proposal_items_bill_idx
  ON tenant.accounting_vendor_payment_proposal_items(
    organization_id, vendor_bill_id, status
  );

INSERT INTO tenant.accounting_payables_governance_policies (
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

ALTER TABLE tenant.accounting_payables_governance_policies
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_governance_policies
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_saved_views
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_saved_views
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_governance_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_governance_snapshots
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_exception_cases
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_payables_exception_cases
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_vendor_payment_proposals
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_vendor_payment_proposals
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_vendor_payment_proposal_items
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_vendor_payment_proposal_items
  FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_payables_governance_policies',
    'accounting_payables_saved_views',
    'accounting_payables_governance_snapshots',
    'accounting_payables_exception_cases',
    'accounting_vendor_payment_proposals',
    'accounting_vendor_payment_proposal_items'
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
