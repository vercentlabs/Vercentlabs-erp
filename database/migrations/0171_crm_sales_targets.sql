-- CRM plan, step 3.7: monthly targets per salesperson.
--
-- A target is set for one person and one month, on one measure: the value won (in the base currency), the deals won, the new leads
-- they take on, or the calls, emails, meetings and messages they log. The Targets report sets each against what was done. Set by
-- whoever manages CRM settings or reassigns leads; seen by the person themselves and their managers.
CREATE TABLE IF NOT EXISTS tenant.crm_sales_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  metric text NOT NULL CHECK (metric IN ('won_value', 'won_count', 'new_leads', 'activities')),
  target numeric(18, 2) NOT NULL CHECK (target >= 0),
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_sales_targets_uidx UNIQUE (organization_id, user_id, month, metric)
);
CREATE INDEX IF NOT EXISTS crm_sales_targets_month_idx ON tenant.crm_sales_targets (organization_id, month);
ALTER TABLE tenant.crm_sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_sales_targets FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_sales_targets' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_sales_targets USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_sales_targets TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0171_crm_sales_targets.sql', 'crm-sales-targets') ON CONFLICT DO NOTHING;
