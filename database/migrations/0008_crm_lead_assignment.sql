-- CRM Lead Assignment: who is responsible for each lead, how they got it,
-- and the rules that route new leads.
--
--   1. Assignment fields on the lead (assigned by, method, rule, first activity)
--   2. Assignment history — append-only, one row per change of owner or team
--   3. Assignment rules — ordered conditions that route a lead to a user or a
--      team (directly or round-robin among the team's members)
--   4. Round-robin pointer per team
--   5. Assignment settings per organization (self-assignment, what manual
--      creation does, the fallback when no rule matches)
--   6. Row-level security and grants
--   7. Permissions
--
-- Run once, after 0005_crm_leads.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. assignment fields on the lead

ALTER TABLE tenant.crm_leads
  ADD COLUMN assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN assignment_method text,
  ADD COLUMN assignment_rule_id uuid,
  -- set by the first logged activity, so "assigned 2 days ago, nothing done" is visible
  ADD COLUMN first_activity_at timestamp with time zone,
  ADD CONSTRAINT crm_leads_assignment_method_check CHECK (assignment_method IS NULL OR assignment_method = ANY (ARRAY[
    'manual', 'self', 'rule', 'round_robin', 'fallback', 'bulk', 'import', 'creator', 'transfer', 'integration']));

CREATE INDEX crm_leads_unassigned_idx ON tenant.crm_leads (organization_id, created_at) WHERE owner_user_id IS NULL AND status = 'open' AND archived_at IS NULL;

-- ============================================================ 2. assignment history

CREATE TABLE tenant.crm_lead_assignment_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  previous_owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  new_owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  previous_team_id uuid,
  new_team_id uuid,
  assignment_method text NOT NULL,
  assignment_rule_id uuid,
  assignment_rule_name text,
  reason text,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  -- a retried request with the same key is recorded once
  request_key text,
  CONSTRAINT crm_lead_assignment_history_method_check CHECK (assignment_method = ANY (ARRAY[
    'manual', 'self', 'rule', 'round_robin', 'fallback', 'bulk', 'import', 'creator', 'transfer', 'integration'])),
  CONSTRAINT crm_lead_assignment_history_reason_check CHECK (reason IS NULL OR char_length(reason) <= 500),
  CONSTRAINT crm_lead_assignment_history_lead_fkey FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_lead_assignment_history_lead_idx ON tenant.crm_lead_assignment_history (organization_id, lead_id, assigned_at DESC);
CREATE INDEX crm_lead_assignment_history_owner_idx ON tenant.crm_lead_assignment_history (organization_id, new_owner_id, assigned_at DESC);
CREATE UNIQUE INDEX crm_lead_assignment_history_request_uidx ON tenant.crm_lead_assignment_history (organization_id, lead_id, request_key) WHERE request_key IS NOT NULL;

-- ============================================================ 3. assignment rules
-- conditions: [{ "field": "state", "operator": "equals", "value": "Maharashtra" }, …]
-- all conditions must match. The first active rule (lowest priority number)
-- that matches wins.

CREATE TABLE tenant.crm_lead_assignment_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority integer NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
  target_type text NOT NULL,
  target_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  target_team_id uuid,
  -- direct: the user, or the team with no owner; round_robin: the next member of the team
  strategy text DEFAULT 'direct' NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_assignment_rules_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT crm_lead_assignment_rules_priority_check CHECK (priority BETWEEN 1 AND 10000),
  CONSTRAINT crm_lead_assignment_rules_conditions_check CHECK (jsonb_typeof(conditions) = 'array'),
  CONSTRAINT crm_lead_assignment_rules_target_type_check CHECK (target_type = ANY (ARRAY['user', 'team'])),
  CONSTRAINT crm_lead_assignment_rules_strategy_check CHECK (strategy = ANY (ARRAY['direct', 'round_robin'])),
  CONSTRAINT crm_lead_assignment_rules_target_check CHECK (
    (target_type = 'user' AND strategy = 'direct') OR (target_type = 'team' AND target_team_id IS NOT NULL)),
  CONSTRAINT crm_lead_assignment_rules_team_fkey FOREIGN KEY (organization_id, target_team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (target_team_id)
);
CREATE INDEX crm_lead_assignment_rules_order_idx ON tenant.crm_lead_assignment_rules (organization_id, priority, created_at) WHERE is_active;
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.crm_lead_assignment_rules FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

ALTER TABLE tenant.crm_leads
  ADD CONSTRAINT crm_leads_assignment_rule_fkey FOREIGN KEY (assignment_rule_id) REFERENCES tenant.crm_lead_assignment_rules(id) ON DELETE SET NULL;

-- ============================================================ 4. round-robin pointer

CREATE TABLE tenant.crm_lead_round_robin_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  last_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_round_robin_state_pkey PRIMARY KEY (organization_id, team_id),
  CONSTRAINT crm_lead_round_robin_state_team_fkey FOREIGN KEY (organization_id, team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE CASCADE
);

-- ============================================================ 5. assignment settings

CREATE TABLE tenant.crm_lead_assignment_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- salespeople may take unassigned leads with "Assign to me"
  allow_self_assignment boolean DEFAULT true NOT NULL,
  -- a lead someone types in: "creator" becomes the owner, or "rules" route it
  manual_creation_mode text DEFAULT 'creator' NOT NULL,
  -- when no rule matches: leave unassigned, or give it to a default user / team
  fallback_mode text DEFAULT 'unassigned' NOT NULL,
  fallback_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  fallback_team_id uuid,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_lead_assignment_settings_manual_check CHECK (manual_creation_mode = ANY (ARRAY['creator', 'rules'])),
  CONSTRAINT crm_lead_assignment_settings_fallback_check CHECK (fallback_mode = ANY (ARRAY['unassigned', 'user', 'team'])),
  CONSTRAINT crm_lead_assignment_settings_team_fkey FOREIGN KEY (organization_id, fallback_team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (fallback_team_id)
);

-- ============================================================ 6. row-level security and grants

ALTER TABLE tenant.crm_lead_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_assignment_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_lead_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_assignment_rules USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_lead_round_robin_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_round_robin_state FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_round_robin_state USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_lead_assignment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_lead_assignment_settings USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

-- The assignment history can be read and added to, never changed or removed.
GRANT SELECT, INSERT ON TABLE tenant.crm_lead_assignment_history TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_lead_assignment_rules TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_lead_assignment_rules TO vercent_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_lead_round_robin_state TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_lead_assignment_settings TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_lead_assignment_settings TO vercent_worker;

-- ============================================================ 7. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.leads.assign_self', 'Assign leads to self', 'CRM', 'Take an unassigned lead with Assign to me, when the organization allows it.'),
  ('crm.leads.bulk_assign', 'Bulk assign leads', 'CRM', 'Assign or reassign many leads at once.'),
  ('crm.leads.assign_across_teams', 'Assign leads across teams', 'CRM', 'Give leads to anyone in the organization, not only to members of teams you manage.'),
  ('crm.leads.manage_assignment_rules', 'Manage lead assignment rules', 'CRM', 'Create and order assignment rules, set the fallback and transfer a user''s leads.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist: their standard roles get the permissions the
-- role templates now carry (packages/permissions/src/roles.js).
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON
       (permission.key = 'crm.leads.assign_self' AND role.slug = ANY (ARRAY[
          'sales_representative', 'sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'marketing_manager']))
    OR (permission.key = 'crm.leads.bulk_assign' AND role.slug = ANY (ARRAY[
          'sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'marketing_manager']))
    OR (permission.key = ANY (ARRAY['crm.leads.assign_across_teams', 'crm.leads.manage_assignment_rules'])
        AND role.slug = ANY (ARRAY['sales_head', 'sales_operations', 'crm_administrator']))
    OR (permission.key = ANY (ARRAY['crm.leads.assign_self', 'crm.leads.bulk_assign', 'crm.leads.assign_across_teams', 'crm.leads.manage_assignment_rules'])
        AND role.slug = 'system_administrator')
 WHERE role.is_system
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0008_crm_lead_assignment.sql', 'crm-lead-assignment');
