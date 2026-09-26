BEGIN;

-- Prompt 6: database-level organisation isolation for the organisation-scoped
-- public/platform tables (classification: packages/database/src/
-- table-classification.js — the only source of truth; verify:db checks this
-- migration against it).
--
-- Context is server-owned and transaction-local (set_config(..., true)):
--   app.current_organization_id  from the authenticated session, API key or
--                                durable job/event (never request input)
--   app.current_user_id          from a verified session token only; lets a
--                                user read their OWN memberships across
--                                organisations (session resolution, switcher)
-- A missing context reads as NULL, so nothing matches: missing context can
-- never read organisation data. FORCE applies the policies to the table
-- owner too; the migration role must hold BYPASSRLS for backfills.

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.current_organization_id', true) IS NULL
      OR current_setting('app.current_organization_id', true) = ''
    THEN NULL
    ELSE current_setting('app.current_organization_id', true)::uuid
  END
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.current_user_id', true) IS NULL
      OR current_setting('app.current_user_id', true) = ''
    THEN NULL
    ELSE current_setting('app.current_user_id', true)::uuid
  END
$$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.companies;
CREATE POLICY organization_isolation ON public.companies USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.branches;
CREATE POLICY organization_isolation ON public.branches USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.departments;
CREATE POLICY organization_isolation ON public.departments USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.teams;
CREATE POLICY organization_isolation ON public.teams USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.cost_centers;
CREATE POLICY organization_isolation ON public.cost_centers USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.roles;
CREATE POLICY organization_isolation ON public.roles USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.role_version_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_version_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.role_version_snapshots;
CREATE POLICY organization_isolation ON public.role_version_snapshots USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.user_role_assignments;
CREATE POLICY organization_isolation ON public.user_role_assignments USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.access_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_assignment_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.access_assignment_events;
CREATE POLICY organization_isolation ON public.access_assignment_events USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.membership_company_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_company_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.membership_company_access;
CREATE POLICY organization_isolation ON public.membership_company_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.membership_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_branch_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.membership_branch_access;
CREATE POLICY organization_isolation ON public.membership_branch_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.membership_department_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_department_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.membership_department_access;
CREATE POLICY organization_isolation ON public.membership_department_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.membership_team_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_team_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.membership_team_access;
CREATE POLICY organization_isolation ON public.membership_team_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_memberships;
CREATE POLICY organization_isolation ON public.organization_memberships USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
DROP POLICY IF EXISTS own_rows_read ON public.organization_memberships;
CREATE POLICY own_rows_read ON public.organization_memberships FOR SELECT USING (user_id = public.current_app_user_id());

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_invitations;
CREATE POLICY organization_isolation ON public.organization_invitations USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_invitation_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitation_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_invitation_roles;
CREATE POLICY organization_isolation ON public.organization_invitation_roles USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_invitation_company_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitation_company_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_invitation_company_access;
CREATE POLICY organization_isolation ON public.organization_invitation_company_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_invitation_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitation_branch_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_invitation_branch_access;
CREATE POLICY organization_isolation ON public.organization_invitation_branch_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_invitation_department_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitation_department_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_invitation_department_access;
CREATE POLICY organization_isolation ON public.organization_invitation_department_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_invitation_team_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitation_team_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_invitation_team_access;
CREATE POLICY organization_isolation ON public.organization_invitation_team_access USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_modules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.organization_modules;
CREATE POLICY organization_isolation ON public.organization_modules USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.user_preferences;
CREATE POLICY organization_isolation ON public.user_preferences USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.notifications;
CREATE POLICY organization_isolation ON public.notifications USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.notification_preferences;
CREATE POLICY organization_isolation ON public.notification_preferences USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.approval_requests;
CREATE POLICY organization_isolation ON public.approval_requests USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.approval_decisions;
CREATE POLICY organization_isolation ON public.approval_decisions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.audit_events;
CREATE POLICY organization_isolation ON public.audit_events USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id() OR organization_id IS NULL);

ALTER TABLE public.favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favourites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.favourites;
CREATE POLICY organization_isolation ON public.favourites USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.recent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recent_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.recent_records;
CREATE POLICY organization_isolation ON public.recent_records USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.activities;
CREATE POLICY organization_isolation ON public.activities USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.comments;
CREATE POLICY organization_isolation ON public.comments USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.attachments;
CREATE POLICY organization_isolation ON public.attachments USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.custom_field_definitions;
CREATE POLICY organization_isolation ON public.custom_field_definitions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.custom_field_values;
CREATE POLICY organization_isolation ON public.custom_field_values USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.custom_field_value_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_value_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.custom_field_value_history;
CREATE POLICY organization_isolation ON public.custom_field_value_history USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.tag_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.tag_definitions;
CREATE POLICY organization_isolation ON public.tag_definitions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.entity_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.entity_tags;
CREATE POLICY organization_isolation ON public.entity_tags USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.developer_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_apps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.developer_apps;
CREATE POLICY organization_isolation ON public.developer_apps USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.api_keys;
CREATE POLICY organization_isolation ON public.api_keys USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.oauth_states;
CREATE POLICY organization_isolation ON public.oauth_states USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.oauth_connections;
CREATE POLICY organization_isolation ON public.oauth_connections USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.inbound_mail_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_mail_routes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.inbound_mail_routes;
CREATE POLICY organization_isolation ON public.inbound_mail_routes USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.inbound_mail_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_mail_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.inbound_mail_events;
CREATE POLICY organization_isolation ON public.inbound_mail_events USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.configuration_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuration_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.configuration_versions;
CREATE POLICY organization_isolation ON public.configuration_versions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.feature_flags;
CREATE POLICY organization_isolation ON public.feature_flags USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.privacy_requests;
CREATE POLICY organization_isolation ON public.privacy_requests USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.privacy_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_retention_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.privacy_retention_policies;
CREATE POLICY organization_isolation ON public.privacy_retention_policies USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.ai_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.ai_policies;
CREATE POLICY organization_isolation ON public.ai_policies USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.ai_requests;
CREATE POLICY organization_isolation ON public.ai_requests USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.ai_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_evaluations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.ai_evaluations;
CREATE POLICY organization_isolation ON public.ai_evaluations USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.workflow_definitions;
CREATE POLICY organization_isolation ON public.workflow_definitions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.workflow_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_definition_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.workflow_definition_versions;
CREATE POLICY organization_isolation ON public.workflow_definition_versions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.workflow_runs;
CREATE POLICY organization_isolation ON public.workflow_runs USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.report_definitions;
CREATE POLICY organization_isolation ON public.report_definitions USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.report_runs;
CREATE POLICY organization_isolation ON public.report_runs USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.sales_public_quote_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_public_quote_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.sales_public_quote_tokens;
CREATE POLICY organization_isolation ON public.sales_public_quote_tokens USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
-- Organisation-child rows: permission grants of an organisation's role are
-- visible exactly when the role is (roles is itself isolated above).
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.role_permissions;
CREATE POLICY organization_isolation ON public.role_permissions
  USING (EXISTS (SELECT 1 FROM public.roles parent WHERE parent.id = role_permissions.role_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roles parent WHERE parent.id = role_permissions.role_id));

-- Pre-organisation ingress lookups. Each answers ONE question from a hashed
-- credential with the minimum data (the organisation to use), so callers
-- then set app.current_organization_id and continue under RLS. SECURITY
-- DEFINER with a pinned search_path; EXECUTE is revoked from PUBLIC and
-- granted to the runtime roles by db:provision:runtime-role.

CREATE OR REPLACE FUNCTION public.resolve_api_key_organization(p_key_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT key.organization_id FROM public.api_keys key
   WHERE key.key_hash = p_key_hash AND key.status = 'active' AND (key.expires_at IS NULL OR key.expires_at > now())
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.resolve_invitation_organization(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT invitation.organization_id FROM public.organization_invitations invitation
   WHERE invitation.token_hash = p_token_hash
   LIMIT 1
$$;

-- The signed-in user's own pending invitations (the caller passes the email
-- of the authenticated user, never request input).
CREATE OR REPLACE FUNCTION public.pending_invitations_for_email(p_email text)
RETURNS TABLE (id uuid, organization_name text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT invitation.id, organization.name, invitation.expires_at
    FROM public.organization_invitations invitation
    JOIN public.organizations organization ON organization.id = invitation.organization_id
   WHERE lower(invitation.email) = lower(p_email)
     AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL AND invitation.expires_at > now()
   ORDER BY invitation.created_at DESC
   LIMIT 50
$$;

CREATE OR REPLACE FUNCTION public.resolve_public_quote_organization(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT token.organization_id FROM public.sales_public_quote_tokens token WHERE token.token_hash = p_token_hash LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.resolve_inbound_mail_route_organization(p_route_key_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT route.organization_id FROM public.inbound_mail_routes route WHERE route.route_key_hash = p_route_key_hash AND route.status = 'active' LIMIT 1
$$;

-- SaaS billing (OPERATOR_RUNTIME) reconciles subscriptions across
-- organisations, but its audit trail belongs to each organisation. This is
-- the one way it writes that trail outside the organisation's context:
-- billing events only, entity type "billing", append-only like every audit row.
CREATE OR REPLACE FUNCTION public.record_billing_audit_event(
  p_organization_id uuid, p_actor_user_id uuid, p_event_type text, p_entity_id text,
  p_metadata jsonb, p_before_data jsonb, p_after_data jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_event_type IS NULL OR p_event_type NOT LIKE 'billing.%' THEN
    RAISE EXCEPTION 'record_billing_audit_event accepts billing.* events only' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_events (id, organization_id, actor_user_id, event_type, entity_type, entity_id, metadata, before_data, after_data)
  VALUES (gen_random_uuid(), p_organization_id, p_actor_user_id, p_event_type, 'billing', p_entity_id, COALESCE(p_metadata, '{}'::jsonb), p_before_data, p_after_data);
END
$$;

-- The one billable-user formula (core/billing/seats.js), for billing's
-- cross-organisation reconciliation: two counts, never row data.
--   members = active memberships
--   pending = valid pending invitations, one per email, not already a member
CREATE OR REPLACE FUNCTION public.billable_user_count(p_organization_id uuid, p_exclude_invitation_id uuid)
RETURNS TABLE (members integer, pending integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM public.organization_memberships m WHERE m.organization_id = p_organization_id AND m.status = 'active')::int,
    (SELECT count(DISTINCT lower(i.email)) FROM public.organization_invitations i
      WHERE i.organization_id = p_organization_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        AND (p_exclude_invitation_id IS NULL OR i.id <> p_exclude_invitation_id)
        AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m JOIN public.users u ON u.id = m.user_id
                         WHERE m.organization_id = i.organization_id AND m.status = 'active' AND lower(u.email) = lower(i.email)))::int
$$;

REVOKE ALL ON FUNCTION public.resolve_api_key_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billable_user_count(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_sessions_after_access_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_billing_audit_event(uuid, uuid, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_invitation_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pending_invitations_for_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_public_quote_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_inbound_mail_route_organization(text) FROM PUBLIC;

COMMIT;
