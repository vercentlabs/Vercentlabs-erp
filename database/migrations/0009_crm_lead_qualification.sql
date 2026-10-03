-- CRM Lead Qualification: whether a lead is worth pursuing, and why.
--
--   1. Qualification record — one per lead: need, budget, authority, notes
--      (timeframe, product interest, estimated value and rating stay on the
--      lead, where the rest of CRM already reads them)
--   2. Qualification history — append-only, one row per answer changed and
--      per decision (started, qualified, disqualified, reopened, converted)
--   3. Qualification requirements per organization (which criteria must be
--      met before a lead can be qualified)
--   4. Row-level security and grants
--   5. Permissions
--
-- A lead's qualification status is derived, never stored twice:
--   open, no record        Not qualified yet
--   open, with a record    In qualification
--   qualified / converted  Qualified
--   disqualified           Disqualified
--
-- Run once, after 0008_crm_lead_assignment.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. qualification record

CREATE TABLE tenant.crm_lead_qualifications (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  need_status text DEFAULT 'unknown' NOT NULL,
  -- the business problem or requirement, in the customer's words
  need_description text,
  budget_status text DEFAULT 'unknown' NOT NULL,
  budget_min numeric(18,2),
  budget_max numeric(18,2),
  authority_status text DEFAULT 'unknown' NOT NULL,
  -- who decides, for example "Operations Head + CFO"
  authority_detail text,
  notes text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  -- set when a manager qualified the lead although required criteria were missing
  override_reason text,
  overridden_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  overridden_at timestamp with time zone,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_qualifications_pkey PRIMARY KEY (organization_id, lead_id),
  CONSTRAINT crm_lead_qualifications_lead_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_lead_qualifications_need_check CHECK (need_status = ANY (ARRAY['yes', 'no', 'unknown'])),
  CONSTRAINT crm_lead_qualifications_budget_check CHECK (budget_status = ANY (ARRAY['confirmed', 'likely', 'unknown', 'no_budget'])),
  CONSTRAINT crm_lead_qualifications_budget_range_check CHECK (
    (budget_min IS NULL OR budget_min >= 0) AND (budget_max IS NULL OR budget_max >= 0) AND (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)),
  CONSTRAINT crm_lead_qualifications_authority_check CHECK (authority_status = ANY (ARRAY['decision_maker', 'influencer', 'unknown', 'no_authority'])),
  CONSTRAINT crm_lead_qualifications_override_check CHECK ((overridden_at IS NULL) = (override_reason IS NULL))
);
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.crm_lead_qualifications FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

CREATE INDEX crm_leads_qualified_at_idx ON tenant.crm_leads (organization_id, qualified_at) WHERE qualified_at IS NOT NULL;

-- ============================================================ 2. qualification history

CREATE TABLE tenant.crm_lead_qualification_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  event_type text NOT NULL,
  -- for "updated": the answer that changed, and its values as the user saw them
  field text,
  old_value text,
  new_value text,
  notes text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_lead_qualification_history_event_check CHECK (event_type = ANY (ARRAY[
    'started', 'updated', 'rating_changed', 'qualified', 'qualified_override', 'disqualified', 'reopened', 'converted'])),
  CONSTRAINT crm_lead_qualification_history_lead_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_lead_qualification_history_lead_idx ON tenant.crm_lead_qualification_history (organization_id, lead_id, changed_at DESC);

-- ============================================================ 3. qualification requirements

CREATE TABLE tenant.crm_lead_qualification_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  need_required boolean DEFAULT true NOT NULL,
  budget_required boolean DEFAULT false NOT NULL,
  authority_required boolean DEFAULT true NOT NULL,
  timeline_required boolean DEFAULT false NOT NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================ 4. row-level security and grants

ALTER TABLE tenant.crm_lead_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_qualifications FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_qualifications USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_lead_qualification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_qualification_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_qualification_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_lead_qualification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_qualification_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_qualification_settings USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_lead_qualifications TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_lead_qualifications TO vercent_worker;
-- The qualification history can be read and added to, never changed or removed.
GRANT SELECT, INSERT ON TABLE tenant.crm_lead_qualification_history TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_lead_qualification_settings TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_lead_qualification_settings TO vercent_worker;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.leads.override_qualification', 'Override lead qualification requirements', 'CRM', 'Qualify a lead although required qualification criteria are missing, with a reason.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist: managers and administrators get the override.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'crm.leads.override_qualification'
  FROM public.roles role
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'marketing_manager', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0009_crm_lead_qualification.sql', 'crm-lead-qualification');
