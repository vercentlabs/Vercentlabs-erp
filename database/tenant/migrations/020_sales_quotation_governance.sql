BEGIN;

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_governance_policies (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  approval_sla_hours integer NOT NULL DEFAULT 24
    CHECK (approval_sla_hours BETWEEN 1 AND 8760),
  sent_follow_up_days integer NOT NULL DEFAULT 3
    CHECK (sent_follow_up_days BETWEEN 1 AND 365),
  expiry_warning_days integer NOT NULL DEFAULT 7
    CHECK (expiry_warning_days BETWEEN 1 AND 365),
  stale_after_days integer NOT NULL DEFAULT 14
    CHECK (stale_after_days BETWEEN 1 AND 3650),
  require_payment_terms boolean NOT NULL DEFAULT true,
  require_billing_address boolean NOT NULL DEFAULT true,
  require_contact boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_saved_views (
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

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL,
  quotation_version_id uuid NOT NULL,
  lifecycle_status text NOT NULL,
  approval_status text NOT NULL,
  acceptance_status text NOT NULL,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'attention', 'blocked')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, quotation_id)
    REFERENCES tenant.sales_quotations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, quotation_version_id)
    REFERENCES tenant.sales_quotation_versions(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sales_quotation_saved_views_owner_idx
  ON tenant.sales_quotation_saved_views(
    organization_id, owner_user_id, is_shared, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS sales_quotation_governance_snapshots_quote_idx
  ON tenant.sales_quotation_governance_snapshots(
    organization_id, quotation_id, captured_at DESC
  );

INSERT INTO tenant.sales_quotation_governance_policies (
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

ALTER TABLE tenant.sales_quotation_governance_policies
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_quotation_governance_policies
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_quotation_saved_views
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_quotation_saved_views
  FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_quotation_governance_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_quotation_governance_snapshots
  FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_quotation_governance_policies',
    'sales_quotation_saved_views',
    'sales_quotation_governance_snapshots'
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
