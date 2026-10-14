-- Projects: the project master and its lifecycle — the shared identity, scope, responsibility and coordination every later Projects feature
-- (tasks, milestones, time, budgets, billing) builds on. Other modules keep their own records: a project links to a customer, an opportunity,
-- a quotation, a sales order, an invoice, a purchase order or a supplier bill by typed reference, never by copying it.
--
--   settings          per company: whether activation needs approval, the due-soon window, customer acceptance at completion.
--   types             a simple, configurable category (implementation, construction, campaign, ...), seeded for every company.
--   projects          DRAFT -> PLANNED -> IN_PROGRESS -> COMPLETED, with ON_HOLD (back to the status it interrupted) and CANCELLED; a
--                     completed project may be reopened; a completed or cancelled one archived (and restored); an unused draft deleted
--                     softly. Code from the company's numbering; a create key so a repeated request never makes a second project.
--   members           who works on it and in what project role; history kept (left_at), one active membership per person.
--   links             typed references to records other modules own (module, type, id, optional line, link type).
--   status events     every lifecycle change, append-only.
--   holds             each pause: reason, owner, the status it interrupted, resolution.
--   events            the activity timeline, append-only (tamper-resistant; comments are notes).
--   notes             timestamped updates with their author; edited and removed softly.
--   saved views       a person's named filters for the project list, one default.
--   alerts            due-date and health alerts already sent (each once).
--
-- The project tables of the earlier implementation (never used) are renamed aside as legacy_* where they still exist; nothing is dropped.

-- ============================================================ 0. the earlier tables, renamed aside
DO $$
DECLARE
  name text;
  idx record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'tenant' AND table_name = 'projects' AND column_name = 'project_number') THEN
    FOREACH name IN ARRAY ARRAY['projects', 'project_baselines', 'project_billing_milestones', 'project_budgets', 'project_comments', 'project_documents', 'project_events',
        'project_expenses', 'project_issues', 'project_materials', 'project_members', 'project_milestones', 'project_procurement_links', 'project_profitability_snapshots',
        'project_risks', 'project_settings', 'project_status_reports', 'project_task_dependencies', 'project_tasks', 'project_template_items', 'project_templates',
        'project_time_entries', 'project_timesheets'] LOOP
      IF to_regclass('tenant.' || name) IS NOT NULL AND to_regclass('tenant.legacy_' || name) IS NULL THEN
        -- Their indexes (and the constraints behind them) move aside too, so the new tables can use the plain names.
        FOR idx IN SELECT indexrelid::regclass::text AS qualified, (SELECT relname FROM pg_class WHERE oid = indexrelid) AS short
                     FROM pg_index WHERE indrelid = ('tenant.' || name)::regclass LOOP
          EXECUTE format('ALTER INDEX %s RENAME TO %I', idx.qualified, left('legacy_' || idx.short, 63));
        END LOOP;
        -- Check and foreign-key constraints too (Postgres names new constraints around existing ones).
        FOR idx IN SELECT conname AS short FROM pg_constraint WHERE conrelid = ('tenant.' || name)::regclass AND contype IN ('c', 'f') AND conname NOT LIKE 'legacy\_%' LOOP
          EXECUTE format('ALTER TABLE tenant.%I RENAME CONSTRAINT %I TO %I', name, idx.short, left('legacy_' || idx.short, 63));
        END LOOP;
        EXECUTE format('ALTER TABLE tenant.%I RENAME TO %I', name, 'legacy_' || name);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ============================================================ 1. settings and types
CREATE TABLE IF NOT EXISTS tenant.project_settings (
  organization_id uuid PRIMARY KEY,
  activation_approval_required boolean NOT NULL DEFAULT false,
  self_approval_allowed boolean NOT NULL DEFAULT false,
  due_soon_days integer NOT NULL DEFAULT 7 CHECK (due_soon_days BETWEEN 1 AND 90),
  customer_acceptance_required boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.project_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  description text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_types_code_uidx ON tenant.project_types (organization_id, code);

INSERT INTO tenant.project_types (organization_id, code, name, description, sort_order)
SELECT organization.id, kind.code, kind.name, kind.description, kind.sort_order FROM public.organizations organization
  CROSS JOIN (VALUES
    ('IMPLEMENTATION', 'Customer implementation', 'Setting up a product or system for a customer', 10),
    ('SOFTWARE', 'Software development', 'Building or changing software', 20),
    ('DESIGN', 'Design', 'Website, product or graphic design', 30),
    ('CONSTRUCTION', 'Construction or installation', 'Site work, installation and commissioning', 40),
    ('MARKETING', 'Marketing campaign', 'A campaign or launch', 50),
    ('CONSULTING', 'Consulting engagement', 'Advisory or professional services', 60),
    ('SERVICE_DELIVERY', 'Service delivery', 'Delivering a contracted service', 70),
    ('INTERNAL', 'Internal initiative', 'An initiative inside the company', 80),
    ('OTHER', 'Other', 'Anything else', 90)
  ) AS kind(code, name, description, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================================ 2. projects
CREATE TABLE IF NOT EXISTS tenant.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_code text NOT NULL,
  -- A draft may be saved before its name is settled; activation needs it.
  name text CHECK (name IS NULL OR length(btrim(name)) BETWEEN 2 AND 200),
  description text,
  classification text NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('INTERNAL', 'CUSTOMER')),
  project_type_id uuid REFERENCES tenant.project_types(id),
  customer_id uuid REFERENCES tenant.business_parties(id),
  customer_contact_id uuid REFERENCES tenant.contacts(id),
  manager_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  -- The status a hold interrupted (it resumes there).
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('PLANNED', 'IN_PROGRESS')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  planned_start_date date,
  target_end_date date,
  actual_start_date date,
  completed_at date,
  completed_by uuid REFERENCES public.users(id),
  completion_note text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  approval_requested_by uuid REFERENCES public.users(id),
  approval_requested_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  -- A delivery risk the manager flagged (shown in health with its note), and a manager's explanation of the current health warning.
  risk_flagged boolean NOT NULL DEFAULT false,
  risk_note text,
  health_note text,
  health_noted_by uuid REFERENCES public.users(id),
  health_noted_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}',
  -- Templates (a later feature) are referenced, never copied into a live link.
  template_id uuid,
  template_name text,
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'SALES_ORDER', 'IMPORT', 'TEMPLATE')),
  create_key text,
  archived_at timestamptz,
  archived_by uuid REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_dates_check CHECK (target_end_date IS NULL OR planned_start_date IS NULL OR target_end_date >= planned_start_date),
  -- Past the draft, a project has what activation demands (a cancelled draft may lack it).
  CONSTRAINT projects_activation_check CHECK (status IN ('DRAFT', 'CANCELLED') OR (name IS NOT NULL AND manager_user_id IS NOT NULL AND planned_start_date IS NOT NULL
    AND target_end_date IS NOT NULL AND project_type_id IS NOT NULL AND (classification = 'INTERNAL' OR customer_id IS NOT NULL))),
  CONSTRAINT projects_internal_check CHECK (classification = 'CUSTOMER' OR (customer_id IS NULL AND customer_contact_id IS NULL)),
  CONSTRAINT projects_completion_check CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CONSTRAINT projects_cancel_check CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(btrim(COALESCE(cancel_reason, ''))) >= 3)),
  CONSTRAINT projects_hold_check CHECK ((status = 'ON_HOLD') = (previous_status IS NOT NULL)),
  CONSTRAINT projects_archive_check CHECK (archived_at IS NULL OR status IN ('COMPLETED', 'CANCELLED')),
  CONSTRAINT projects_delete_check CHECK (deleted_at IS NULL OR status IN ('DRAFT', 'CANCELLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_code_uidx ON tenant.projects (organization_id, project_code);
CREATE UNIQUE INDEX IF NOT EXISTS projects_create_key_uidx ON tenant.projects (organization_id, create_key) WHERE create_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS projects_status_idx ON tenant.projects (organization_id, status, target_end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_manager_idx ON tenant.projects (organization_id, manager_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_customer_idx ON tenant.projects (organization_id, customer_id) WHERE customer_id IS NOT NULL;

-- ============================================================ 3. members, links, holds
CREATE TABLE IF NOT EXISTS tenant.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text NOT NULL CHECK (role IN ('MANAGER', 'MEMBER', 'VIEWER', 'FINANCIAL_VIEWER')),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  added_by uuid REFERENCES public.users(id),
  left_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  removal_note text,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_members_active_uidx ON tenant.project_members (project_id, user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS project_members_user_idx ON tenant.project_members (organization_id, user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  source_module text NOT NULL CHECK (source_module IN ('CRM', 'SALES', 'PROCUREMENT', 'FINANCE')),
  source_type text NOT NULL CHECK (source_type IN ('CRM_ACCOUNT', 'CRM_CONTACT', 'CRM_OPPORTUNITY', 'SALES_QUOTATION', 'SALES_ORDER', 'SALES_INVOICE', 'PURCHASE_ORDER', 'SUPPLIER_BILL')),
  source_id uuid NOT NULL,
  source_line_id uuid,
  link_type text NOT NULL DEFAULT 'RELATED' CHECK (link_type IN ('ORIGIN', 'DELIVERY', 'BILLING', 'RELATED')),
  note text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_links_active_uidx ON tenant.project_links (project_id, source_type, source_id, COALESCE(source_line_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS project_links_source_idx ON tenant.project_links (organization_id, source_type, source_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  previous_status text NOT NULL CHECK (previous_status IN ('PLANNED', 'IN_PROGRESS')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  owner_user_id uuid REFERENCES public.users(id),
  expected_resolution_date date,
  started_by uuid REFERENCES public.users(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution text,
  CHECK (resolved_at IS NULL OR length(btrim(COALESCE(resolution, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_holds_active_uidx ON tenant.project_holds (project_id) WHERE resolved_at IS NULL;

-- ============================================================ 4. history, notes, views, alerts
CREATE TABLE IF NOT EXISTS tenant.project_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_status_events_idx ON tenant.project_status_events (organization_id, project_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_status_events_key_uidx ON tenant.project_status_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.project_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  action text NOT NULL,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_events_idx ON tenant.project_events (organization_id, project_id, occurred_at);
CREATE INDEX IF NOT EXISTS project_events_recent_idx ON tenant.project_events (organization_id, occurred_at);

CREATE TABLE IF NOT EXISTS tenant.project_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  author_user_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  row_version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS project_notes_idx ON tenant.project_notes (organization_id, project_id, created_at);

CREATE TABLE IF NOT EXISTS tenant.project_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_saved_views_name_uidx ON tenant.project_saved_views (organization_id, user_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS project_saved_views_default_uidx ON tenant.project_saved_views (organization_id, user_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS tenant.project_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  alert_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_alerts_key_uidx ON tenant.project_alerts (organization_id, project_id, alert_key);

-- ============================================================ 5. guards
CREATE OR REPLACE FUNCTION tenant.projects_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A project is never deleted; cancel, archive or (an unused draft) remove it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_code <> OLD.project_code OR NEW.organization_id <> OLD.organization_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'A project keeps its code.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('PLANNED', 'CANCELLED'))
    OR (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'ON_HOLD', 'CANCELLED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('ON_HOLD', 'COMPLETED', 'CANCELLED'))
    OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('PLANNED', 'IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS')) THEN
    RAISE EXCEPTION 'A project cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- A removed draft stays removed.
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'A removed project stays removed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.projects_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Project history is never changed.' USING ERRCODE = 'check_violation';
END $$;
CREATE OR REPLACE FUNCTION tenant.projects_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Project records are ended, never deleted.' USING ERRCODE = 'check_violation';
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'projects_record_guard' AND tgrelid = 'tenant.projects'::regclass) THEN
    CREATE TRIGGER projects_record_guard BEFORE UPDATE OR DELETE ON tenant.projects FOR EACH ROW EXECUTE FUNCTION tenant.projects_record_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['project_status_events', 'project_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['project_members', 'project_links', 'project_holds', 'project_notes', 'project_alerts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_no_delete' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete()', name || '_no_delete', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_settings', 'project_types', 'projects', 'project_members', 'project_links', 'project_holds', 'project_status_events', 'project_events',
                             'project_notes', 'project_saved_views', 'project_alerts'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_settings, tenant.project_types, tenant.projects, tenant.project_members, tenant.project_links, tenant.project_holds,
  tenant.project_notes, tenant.project_alerts TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.project_saved_views TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_status_events, tenant.project_events TO vercent_app;
GRANT SELECT ON tenant.project_settings, tenant.project_types, tenant.projects, tenant.project_members, tenant.project_links, tenant.project_holds, tenant.project_status_events,
  tenant.project_events, tenant.project_notes, tenant.project_saved_views TO vercent_worker;
GRANT SELECT, INSERT ON tenant.project_alerts TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.view', 'View projects', 'Projects', 'See the projects you manage or belong to.'),
  ('projects.view_all', 'View all projects', 'Projects', 'See every project of the company, not only your own.'),
  ('projects.create', 'Create projects', 'Projects', 'Create projects (drafts), including from a sales order and by import.'),
  ('projects.edit', 'Edit projects', 'Projects', 'Change a project''s details.'),
  ('projects.approve', 'Approve projects', 'Projects', 'Approve a project''s activation where the company asks for it.'),
  ('projects.members.manage', 'Manage project members', 'Projects', 'Add, change and remove project members.'),
  ('projects.links.manage', 'Manage project links', 'Projects', 'Link CRM, sales and procurement records to projects.'),
  ('projects.start', 'Start projects', 'Projects', 'Activate a project and start its execution.'),
  ('projects.hold', 'Put projects on hold', 'Projects', 'Pause a project with a reason.'),
  ('projects.resume', 'Resume projects', 'Projects', 'Resolve a project hold and resume it.'),
  ('projects.complete', 'Complete projects', 'Projects', 'Complete a project once its closing checks pass.'),
  ('projects.reopen', 'Reopen projects', 'Projects', 'Reopen a completed project, with a reason.'),
  ('projects.cancel', 'Cancel projects', 'Projects', 'Cancel a project after reviewing what depends on it.'),
  ('projects.archive', 'Archive projects', 'Projects', 'Archive and restore completed or cancelled projects; remove unused drafts.'),
  ('projects.financial_view', 'View project financials', 'Projects', 'See amounts on the commercial records linked to projects.'),
  ('projects.export', 'Export projects', 'Projects', 'Export the project directory.'),
  ('projects.reports.view', 'View project reports', 'Projects', 'View project overview reports.'),
  ('projects.settings.manage', 'Manage project settings', 'Projects', 'Manage project types and the company''s project policy.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.view'), ('project_manager', 'projects.view_all'), ('project_manager', 'projects.create'), ('project_manager', 'projects.edit'),
    ('project_manager', 'projects.approve'), ('project_manager', 'projects.members.manage'), ('project_manager', 'projects.links.manage'), ('project_manager', 'projects.start'),
    ('project_manager', 'projects.hold'), ('project_manager', 'projects.resume'), ('project_manager', 'projects.complete'), ('project_manager', 'projects.reopen'),
    ('project_manager', 'projects.cancel'), ('project_manager', 'projects.archive'), ('project_manager', 'projects.financial_view'), ('project_manager', 'projects.export'),
    ('project_manager', 'projects.reports.view'), ('project_manager', 'projects.settings.manage'),
    ('employee', 'projects.view'),
    ('sales_head', 'projects.view'), ('sales_head', 'projects.create'), ('sales_head', 'projects.links.manage'),
    ('sales_manager', 'projects.view'), ('sales_manager', 'projects.create'), ('sales_manager', 'projects.links.manage'),
    ('finance_manager', 'projects.view'), ('finance_manager', 'projects.view_all'), ('finance_manager', 'projects.financial_view'), ('finance_manager', 'projects.reports.view'),
    ('finance_manager', 'projects.export'),
    ('accountant', 'projects.view'), ('accountant', 'projects.view_all'), ('accountant', 'projects.financial_view'), ('accountant', 'projects.reports.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0125_projects.sql', 'projects') ON CONFLICT DO NOTHING;
