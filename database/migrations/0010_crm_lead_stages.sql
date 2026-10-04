-- CRM Lead Stages: where a lead is in the sales process.
--
--   1. Lead stages — the organization's ordered stages. Each has a stable
--      internal code (what the lead stores and the code tests) and a display
--      name an administrator can change. The five system stages always exist.
--   2. Stage history — append-only, one row each time a lead enters a stage
--   3. The lead's stage must be one of the organization's stages
--   4. Row-level security and grants
--   5. Permissions
--
-- Stage is separate from status (open, qualified, disqualified, converted),
-- which stays system-controlled on the lead and changes only through
-- Qualify, Disqualify, Reopen and Convert.
--
-- Run once, after 0009_crm_lead_qualification.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. lead stages

CREATE TABLE tenant.crm_lead_stages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- stable: never changes when the stage is renamed
  code text NOT NULL,
  name text NOT NULL,
  sequence integer NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  -- the five built-in stages can be renamed and reordered, never deactivated
  is_system boolean DEFAULT false NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_stages_organization_code_key UNIQUE (organization_id, code),
  CONSTRAINT crm_lead_stages_code_check CHECK (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT crm_lead_stages_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT crm_lead_stages_system_active_check CHECK (is_active OR NOT is_system)
);
CREATE UNIQUE INDEX crm_lead_stages_name_uidx ON tenant.crm_lead_stages (organization_id, lower(btrim(name)));
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.crm_lead_stages FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

-- Organizations that already exist get the standard stages; new ones get
-- them the first time leads are used.
INSERT INTO tenant.crm_lead_stages (organization_id, code, name, sequence, is_system)
SELECT organization.id, stage.code, stage.name, stage.sequence, true
  FROM public.organizations organization
 CROSS JOIN (VALUES ('new', 'New', 10), ('attempting_contact', 'Attempting Contact', 20), ('contacted', 'Contacted', 30),
                    ('nurturing', 'Nurturing', 40), ('qualification', 'Qualification', 50)) AS stage(code, name, sequence)
ON CONFLICT DO NOTHING;

-- ============================================================ 2. stage history

CREATE TABLE tenant.crm_lead_stage_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  -- NULL for the stage a lead is created in
  from_stage text,
  to_stage text NOT NULL,
  note text,
  -- true when an operation moved the lead (Start Qualification, Qualify), not a person choosing a stage
  is_automatic boolean DEFAULT false NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_lead_stage_history_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT crm_lead_stage_history_lead_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_lead_stage_history_lead_idx ON tenant.crm_lead_stage_history (organization_id, lead_id, changed_at DESC);

-- ============================================================ 3. the lead's stage

ALTER TABLE tenant.crm_leads
  ADD CONSTRAINT crm_leads_stage_fkey FOREIGN KEY (organization_id, stage) REFERENCES tenant.crm_lead_stages(organization_id, code);
CREATE INDEX crm_leads_stage_idx ON tenant.crm_leads (organization_id, stage, stage_changed_at) WHERE status = 'open' AND archived_at IS NULL;

-- ============================================================ 4. row-level security and grants

ALTER TABLE tenant.crm_lead_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_stages USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_lead_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_stage_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

-- A stage in use is never deleted: it is deactivated.
GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_lead_stages TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_lead_stages TO vercent_worker;
-- The stage history can be read and added to, never changed or removed.
GRANT SELECT, INSERT ON TABLE tenant.crm_lead_stage_history TO vercent_app, vercent_worker;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.leads.change_stage', 'Change lead stage', 'CRM', 'Move an open lead between stages.'),
  ('crm.leads.manage_stages', 'Manage lead stages', 'CRM', 'Rename, reorder, add and deactivate lead stages.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist: whoever works leads can change their stage;
-- the roles that set up CRM manage the stage list.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON
       (permission.key = 'crm.leads.change_stage' AND role.slug = ANY (ARRAY[
          'sales_representative', 'sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'marketing_manager', 'system_administrator']))
    OR (permission.key = 'crm.leads.manage_stages' AND role.slug = ANY (ARRAY['sales_head', 'sales_operations', 'crm_administrator', 'system_administrator']))
 WHERE role.is_system
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0010_crm_lead_stages.sql', 'crm-lead-stages');
