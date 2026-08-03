BEGIN;

CREATE TABLE IF NOT EXISTS tenant.procurement_governance_policies (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  certification_warning_days integer NOT NULL DEFAULT 30 CHECK (certification_warning_days >= 0),
  sourcing_minimum_bids integer NOT NULL DEFAULT 2 CHECK (sourcing_minimum_bids > 0),
  requisition_sla_days integer NOT NULL DEFAULT 3 CHECK (requisition_sla_days > 0),
  purchase_order_ack_days integer NOT NULL DEFAULT 3 CHECK (purchase_order_ack_days > 0),
  delivery_warning_days integer NOT NULL DEFAULT 5 CHECK (delivery_warning_days >= 0),
  receipt_variance_tolerance numeric(24,6) NOT NULL DEFAULT 0 CHECK (receipt_variance_tolerance >= 0),
  block_expired_certifications boolean NOT NULL DEFAULT true,
  require_qualified_supplier boolean NOT NULL DEFAULT true,
  require_competitive_bids boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.procurement_governance_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('suppliers','requisitions','sourcing-events','agreements','purchase-orders','receipts')),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,owner_user_id,entity_type,name),
  UNIQUE (organization_id,id)
);

CREATE TABLE IF NOT EXISTS tenant.procurement_governance_exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('suppliers','requisitions','sourcing-events','agreements','purchase-orders','receipts')),
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','waiting_supplier','waiting_internal','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  reason_code text NOT NULL DEFAULT 'other' CHECK (reason_code IN ('supplier_compliance','qualification','sourcing_competition','approval_delay','delivery_risk','receipt_variance','contract_compliance','budget_control','other')),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (organization_id,entity_type,entity_id),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,company_id) REFERENCES public.companies(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.procurement_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('suppliers','requisitions','sourcing-events','agreements','purchase-orders','receipts')),
  entity_id uuid NOT NULL,
  entity_status text NOT NULL,
  readiness_status text NOT NULL CHECK (readiness_status IN ('ready','attention','blocked')),
  risk_band text NOT NULL CHECK (risk_band IN ('low','medium','high')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  captured_for text NOT NULL DEFAULT 'manual',
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,company_id) REFERENCES public.companies(organization_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS procurement_governance_saved_views_owner_idx ON tenant.procurement_governance_saved_views(organization_id,owner_user_id,entity_type,updated_at DESC);
CREATE INDEX IF NOT EXISTS procurement_governance_exception_queue_idx ON tenant.procurement_governance_exception_cases(organization_id,company_id,status,priority,next_action_at) WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS procurement_governance_snapshots_entity_idx ON tenant.procurement_governance_snapshots(organization_id,entity_type,entity_id,captured_at DESC);

INSERT INTO tenant.procurement_governance_policies (organization_id,company_id,created_by,updated_by)
SELECT company.organization_id,company.id,organization.created_by,organization.created_by
FROM public.companies company JOIN public.organizations organization ON organization.id=company.organization_id
ON CONFLICT (organization_id,company_id) DO NOTHING;

ALTER TABLE tenant.procurement_governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_saved_views FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_exception_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_exception_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_governance_snapshots FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['procurement_governance_policies','procurement_governance_saved_views','procurement_governance_exception_cases','procurement_governance_snapshots'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',table_name);
  END LOOP;
END $$;

COMMIT;
