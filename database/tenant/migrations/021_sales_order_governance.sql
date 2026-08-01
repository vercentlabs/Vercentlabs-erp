BEGIN;

CREATE TABLE IF NOT EXISTS tenant.sales_order_governance_policies (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  approval_sla_hours integer NOT NULL DEFAULT 24
    CHECK (approval_sla_hours BETWEEN 1 AND 8760),
  fulfillment_sla_days integer NOT NULL DEFAULT 7
    CHECK (fulfillment_sla_days BETWEEN 1 AND 3650),
  delivery_warning_days integer NOT NULL DEFAULT 3
    CHECK (delivery_warning_days BETWEEN 1 AND 365),
  stale_after_days integer NOT NULL DEFAULT 14
    CHECK (stale_after_days BETWEEN 1 AND 3650),
  invoice_handoff_sla_hours integer NOT NULL DEFAULT 24
    CHECK (invoice_handoff_sla_hours BETWEEN 1 AND 8760),
  require_customer_po boolean NOT NULL DEFAULT false,
  require_payment_terms boolean NOT NULL DEFAULT true,
  require_shipping_address boolean NOT NULL DEFAULT true,
  require_line_warehouse boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.sales_order_saved_views (
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

CREATE TABLE IF NOT EXISTS tenant.sales_order_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  lifecycle_status text NOT NULL,
  credit_status text NOT NULL,
  fulfillment_status text NOT NULL,
  billing_status text NOT NULL,
  readiness_status text NOT NULL
    CHECK (readiness_status IN ('ready', 'attention', 'blocked')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, sales_order_id)
    REFERENCES tenant.sales_orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, sales_order_version_id)
    REFERENCES tenant.sales_order_versions(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.sales_return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_number text NOT NULL,
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  reason text NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  completed_at timestamptz,
  UNIQUE (organization_id, request_number),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, sales_order_id)
    REFERENCES tenant.sales_orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, sales_order_version_id)
    REFERENCES tenant.sales_order_versions(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_order_saved_views_owner_idx
  ON tenant.sales_order_saved_views(
    organization_id, owner_user_id, is_shared, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS sales_order_governance_snapshots_order_idx
  ON tenant.sales_order_governance_snapshots(
    organization_id, sales_order_id, captured_at DESC
  );

CREATE INDEX IF NOT EXISTS sales_return_requests_order_idx
  ON tenant.sales_return_requests(
    organization_id, sales_order_id, requested_at DESC
  );

CREATE INDEX IF NOT EXISTS sales_return_requests_queue_idx
  ON tenant.sales_return_requests(organization_id, status, requested_at)
  WHERE status IN ('pending', 'approved');

INSERT INTO tenant.sales_order_governance_policies (
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

ALTER TABLE tenant.sales_order_governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_governance_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_saved_views FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_governance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_governance_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_return_requests FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_order_governance_policies',
    'sales_order_saved_views',
    'sales_order_governance_snapshots',
    'sales_return_requests'
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
