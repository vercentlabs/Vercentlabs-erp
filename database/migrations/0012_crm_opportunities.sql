-- CRM Opportunities: a deal with an account, from first conversation to won
-- or lost.
--
--   1. Opportunity fields — team, priority, what is being sold and why, the
--      next step, and who closed the deal and how
--   2. Opportunity history — append-only audit trail (created, owner, stage,
--      value, close date, status, won, lost, reopened)
--   3. Assignment history — append-only, one row per change of owner or team
--   4. Integrity — a won deal is 100% with a close date, a lost deal is 0%
--      with a reason
--   5. Row-level security and grants
--   6. Permissions
--
-- Stage (where the deal is in the sales process) is separate from status
-- (open, won, lost). Stages, their probabilities, the stage history, the
-- product lines and the contact roles already exist in the baseline; this
-- migration does not change them.
--
-- Run once, after 0011_crm_duplicate_detection.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. opportunity fields

ALTER TABLE tenant.crm_opportunities
  ADD COLUMN team_id uuid,
  ADD COLUMN priority text DEFAULT 'medium' NOT NULL,
  ADD COLUMN product_interest text,
  -- the deal in words: what hurts, what is needed, what is proposed, and the commercial side
  ADD COLUMN business_problem text,
  ADD COLUMN requirements text,
  ADD COLUMN proposed_solution text,
  ADD COLUMN commercial_notes text,
  ADD COLUMN next_step_due_at timestamp with time zone,
  -- true once someone set the probability by hand; a stage change then keeps it
  ADD COLUMN probability_overridden boolean DEFAULT false NOT NULL,
  ADD COLUMN assigned_at timestamp with time zone,
  ADD COLUMN assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- the outcome
  ADD COLUMN won_amount numeric(18,2),
  ADD COLUMN won_at timestamp with time zone,
  ADD COLUMN won_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN lost_at timestamp with time zone,
  ADD COLUMN lost_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN closed_at timestamp with time zone,
  ADD COLUMN competitor_name text,
  -- the stage the deal was in when it was won or lost, so reopening can return to it
  ADD COLUMN stage_before_close_id uuid,
  ADD COLUMN winning_quotation_id uuid,
  ADD COLUMN primary_quotation_id uuid,
  ADD COLUMN archived_at timestamp with time zone,
  ADD COLUMN archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT crm_opportunities_priority_check CHECK (priority = ANY (ARRAY['low', 'medium', 'high'])),
  ADD CONSTRAINT crm_opportunities_won_amount_check CHECK (won_amount IS NULL OR won_amount >= 0),
  ADD CONSTRAINT crm_opportunities_competitor_check CHECK (competitor_name IS NULL OR char_length(competitor_name) <= 200),
  ADD CONSTRAINT crm_opportunities_team_fkey FOREIGN KEY (organization_id, team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (team_id);

CREATE INDEX crm_opportunities_team_idx ON tenant.crm_opportunities (organization_id, team_id) WHERE team_id IS NOT NULL;
CREATE INDEX crm_opportunities_open_close_idx ON tenant.crm_opportunities (organization_id, expected_close_date) WHERE status = 'open';

-- ============================================================ 2. opportunity history

CREATE TABLE tenant.crm_opportunity_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_opportunity_history_event_type_check CHECK (event_type = ANY (ARRAY[
    'created', 'updated', 'owner_changed', 'team_changed', 'stage_changed', 'value_changed', 'close_date_changed', 'probability_changed',
    'product_changed', 'contact_changed', 'quotation_created', 'won', 'lost', 'reopened', 'archived', 'restored']))
);
CREATE INDEX crm_opportunity_history_idx ON tenant.crm_opportunity_history (organization_id, opportunity_id, created_at DESC);

-- ============================================================ 3. assignment history

CREATE TABLE tenant.crm_opportunity_assignment_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  previous_owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  new_owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  previous_team_id uuid,
  new_team_id uuid,
  reason text,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_opportunity_assignment_history_reason_check CHECK (reason IS NULL OR char_length(reason) <= 500)
);
CREATE INDEX crm_opportunity_assignment_history_idx ON tenant.crm_opportunity_assignment_history (organization_id, opportunity_id, assigned_at DESC);

-- ============================================================ 4. integrity
-- NOT VALID: enforced for every row written from now on, without failing on
-- closed deals recorded before these rules existed.

ALTER TABLE tenant.crm_opportunities
  ADD CONSTRAINT crm_opportunities_won_check CHECK (status <> 'won' OR (probability = 100 AND actual_close_date IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT crm_opportunities_lost_check CHECK (status <> 'lost' OR (probability = 0 AND lost_reason_id IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT crm_opportunities_open_check CHECK (status <> 'open' OR actual_close_date IS NULL) NOT VALID;

-- ============================================================ 5. row-level security and grants

ALTER TABLE tenant.crm_opportunity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_opportunity_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_opportunity_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_assignment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_opportunity_assignment_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

-- Both histories can be read and added to, never changed or removed.
GRANT SELECT, INSERT ON TABLE tenant.crm_opportunity_history TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON TABLE tenant.crm_opportunity_assignment_history TO vercent_app, vercent_worker;

-- ============================================================ 6. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.opportunities.view', 'View opportunities', 'CRM', 'See the opportunities you own, your team''s, and unassigned ones.'),
  ('crm.opportunities.view_all', 'View all opportunities', 'CRM', 'See every opportunity in the organization.'),
  ('crm.opportunities.create', 'Create opportunities', 'CRM', 'Add an opportunity for an account.'),
  ('crm.opportunities.edit', 'Edit opportunities', 'CRM', 'Change an opportunity''s details, products and contacts.'),
  ('crm.opportunities.assign', 'Assign opportunities', 'CRM', 'Give an unowned opportunity its first owner.'),
  ('crm.opportunities.reassign', 'Reassign opportunities', 'CRM', 'Move an opportunity from one owner to another.'),
  ('crm.opportunities.change_stage', 'Change opportunity stage', 'CRM', 'Move an open opportunity between sales stages.'),
  ('crm.opportunities.create_quotation', 'Create quotation from opportunity', 'CRM', 'Start a quotation from an opportunity.'),
  ('crm.opportunities.mark_won', 'Mark opportunities won', 'CRM', 'Close an opportunity as won.'),
  ('crm.opportunities.mark_lost', 'Mark opportunities lost', 'CRM', 'Close an opportunity as lost, with a reason.'),
  ('crm.opportunities.reopen', 'Reopen opportunities', 'CRM', 'Reopen a lost opportunity, or a won one that has no sales order.'),
  ('crm.opportunities.delete', 'Delete opportunities', 'CRM', 'Archive an opportunity, or delete one that was created by mistake and never used.'),
  ('crm.opportunities.export', 'Export opportunities', 'CRM', 'Download opportunities as a file.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist. Whoever could manage opportunities can work
-- them day to day; the manager roles also reassign, reopen, delete and export.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'crm.opportunities.view', 'crm.opportunities.create', 'crm.opportunities.edit', 'crm.opportunities.assign', 'crm.opportunities.change_stage',
    'crm.opportunities.create_quotation', 'crm.opportunities.mark_won', 'crm.opportunities.mark_lost'])
 WHERE existing.permission_key = 'crm.opportunities.manage'
ON CONFLICT DO NOTHING;

-- Whoever can read CRM can read opportunities.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.opportunities.view'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'crm.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'crm.opportunities.reassign', 'crm.opportunities.reopen', 'crm.opportunities.delete', 'crm.opportunities.export'])
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'crm.opportunities.view_all'
  FROM public.roles role
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0012_crm_opportunities.sql', 'crm-opportunities');
