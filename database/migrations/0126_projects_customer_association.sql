-- Projects: Customer Association — the validated relationship between a customer project and the customer, its contacts and its commercial
-- records. Projects references the customer master (tenant.business_parties), its contacts and addresses, and the sales documents; it never
-- copies them into an editable customer or contact record of its own.
--
--   projects (columns)  crm_account_id: a provisional CRM-account reference for a draft whose account is not yet a Customer Master (resolved to
--                       customer_id once it is); customer_review_*: a commercial change (a linked sales order cancelled or amended, a merge)
--                       the project manager should review.
--   settings (columns)  customer change approval, a primary contact required at activation, associating an inactive customer.
--   customer contacts   the customer's people on the project with a project role; one current primary contact (kept in projects.customer_contact_id);
--                       removed, never deleted, so history keeps its attribution.
--   customer sites      where the work happens: a snapshot of a customer address (or an address typed for the project), one primary site; a later
--                       change to the customer's address never rewrites it.
--   customer events     append-only history of every association change.
--   change requests     a customer reassignment after the draft: the dependency review, the reason and (where required) someone else's approval.
--   notes               a note may record communication with one of the project's customer contacts.

-- ============================================================ 1. the project's provisional CRM account and its review flag
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS crm_account_id uuid REFERENCES tenant.business_parties(id);
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS customer_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS customer_review_reason text;
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS customer_review_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_crm_account_check' AND conrelid = 'tenant.projects'::regclass) THEN
    -- A provisional CRM account belongs to a customer project that has no customer yet.
    ALTER TABLE tenant.projects ADD CONSTRAINT projects_crm_account_check CHECK (crm_account_id IS NULL OR (classification = 'CUSTOMER' AND customer_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_review_check' AND conrelid = 'tenant.projects'::regclass) THEN
    ALTER TABLE tenant.projects ADD CONSTRAINT projects_review_check CHECK (NOT customer_review_required OR customer_review_reason IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS projects_crm_account_idx ON tenant.projects (organization_id, crm_account_id) WHERE crm_account_id IS NOT NULL;

ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS customer_change_approval_required boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS primary_contact_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS inactive_customer_allowed boolean NOT NULL DEFAULT false;

-- ============================================================ 2. customer contacts
CREATE TABLE IF NOT EXISTS tenant.project_customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  contact_id uuid NOT NULL REFERENCES tenant.contacts(id),
  role text NOT NULL CHECK (role IN ('PRIMARY', 'SPONSOR', 'TECHNICAL', 'BILLING', 'APPROVAL', 'OTHER')),
  -- What the person does on this project ("Project Coordinator"); required for OTHER.
  title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  added_by uuid REFERENCES public.users(id),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_by uuid REFERENCES public.users(id),
  removed_at timestamptz,
  removal_note text,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT project_customer_contacts_other_check CHECK (role <> 'OTHER' OR title IS NOT NULL),
  CONSTRAINT project_customer_contacts_removed_check CHECK ((status = 'REMOVED') = (removed_at IS NOT NULL))
);
-- One current primary contact; one current row per person and role.
CREATE UNIQUE INDEX IF NOT EXISTS project_customer_contacts_primary_uidx ON tenant.project_customer_contacts (project_id) WHERE role = 'PRIMARY' AND status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS project_customer_contacts_role_uidx ON tenant.project_customer_contacts (project_id, contact_id, role) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS project_customer_contacts_contact_idx ON tenant.project_customer_contacts (organization_id, contact_id);

-- The primary contact already chosen on a project becomes its first project contact.
INSERT INTO tenant.project_customer_contacts (organization_id, project_id, contact_id, role, added_by, added_at)
SELECT project.organization_id, project.id, project.customer_contact_id, 'PRIMARY', project.created_by, project.created_at
  FROM tenant.projects project
 WHERE project.customer_contact_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenant.project_customer_contacts existing WHERE existing.project_id = project.id AND existing.role = 'PRIMARY' AND existing.status = 'ACTIVE');

-- ============================================================ 3. customer sites
CREATE TABLE IF NOT EXISTS tenant.project_customer_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  site_name text NOT NULL CHECK (length(btrim(site_name)) BETWEEN 2 AND 120),
  -- The customer address it was taken from (the snapshot below is what the project keeps).
  source_address_id uuid REFERENCES tenant.addresses(id),
  line1 text NOT NULL CHECK (length(btrim(line1)) BETWEEN 2 AND 200),
  line2 text,
  city text NOT NULL CHECK (length(btrim(city)) BETWEEN 2 AND 80),
  district text,
  state text,
  state_code text,
  postal_code text,
  country_code character(2) NOT NULL DEFAULT 'IN' CHECK (country_code ~ '^[A-Z]{2}$'),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_by uuid REFERENCES public.users(id),
  removed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT project_customer_sites_primary_check CHECK (status = 'ACTIVE' OR NOT is_primary),
  CONSTRAINT project_customer_sites_removed_check CHECK ((status = 'REMOVED') = (removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS project_customer_sites_primary_uidx ON tenant.project_customer_sites (project_id) WHERE is_primary AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS project_customer_sites_project_idx ON tenant.project_customer_sites (organization_id, project_id);

-- ============================================================ 4. association history and customer change requests
CREATE TABLE IF NOT EXISTS tenant.project_customer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  event_type text NOT NULL CHECK (event_type IN ('CUSTOMER_ASSIGNED', 'CUSTOMER_CLEARED', 'CRM_ACCOUNT_ASSIGNED', 'CRM_MAPPING_RESOLVED', 'CUSTOMER_CHANGE_REQUESTED',
    'CUSTOMER_CHANGE_APPROVED', 'CUSTOMER_CHANGE_REJECTED', 'CUSTOMER_CHANGE_WITHDRAWN', 'CUSTOMER_REASSIGNED', 'CUSTOMER_MERGED', 'CONTACT_ADDED', 'CONTACT_UPDATED',
    'CONTACT_REMOVED', 'CONTACT_REPLACED', 'CONTACT_MERGED', 'PRIMARY_CONTACT_CHANGED', 'SITE_ADDED', 'SITE_UPDATED', 'SITE_REMOVED', 'SALES_LINKED', 'SALES_UNLINKED',
    'SALES_RECORD_CHANGED', 'REVIEW_FLAGGED', 'REVIEW_CLEARED')),
  from_customer_id uuid REFERENCES tenant.business_parties(id),
  to_customer_id uuid REFERENCES tenant.business_parties(id),
  contact_id uuid REFERENCES tenant.contacts(id),
  summary text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_customer_events_project_idx ON tenant.project_customer_events (organization_id, project_id, occurred_at);
CREATE INDEX IF NOT EXISTS project_customer_events_type_idx ON tenant.project_customer_events (organization_id, event_type, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_customer_events_key_uidx ON tenant.project_customer_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.project_customer_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  from_customer_id uuid REFERENCES tenant.business_parties(id),
  to_customer_id uuid NOT NULL REFERENCES tenant.business_parties(id),
  to_contact_id uuid REFERENCES tenant.contacts(id),
  project_status text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  -- What the reviewer saw (and acknowledged) when the request was made.
  review jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  idempotency_key text,
  CONSTRAINT project_customer_change_requests_decided_check CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CONSTRAINT project_customer_change_requests_rejected_check CHECK (status <> 'REJECTED' OR length(btrim(COALESCE(decision_note, ''))) >= 3)
);
-- One open request per project at a time.
CREATE UNIQUE INDEX IF NOT EXISTS project_customer_change_requests_open_uidx ON tenant.project_customer_change_requests (project_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS project_customer_change_requests_key_uidx ON tenant.project_customer_change_requests (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 5. notes about customer communication
ALTER TABLE tenant.project_notes ADD COLUMN IF NOT EXISTS customer_contact_id uuid REFERENCES tenant.contacts(id);
CREATE INDEX IF NOT EXISTS project_notes_contact_idx ON tenant.project_notes (organization_id, customer_contact_id) WHERE customer_contact_id IS NOT NULL;

-- ============================================================ 6. guards, isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_customer_events_append_only' AND tgrelid = 'tenant.project_customer_events'::regclass) THEN
    CREATE TRIGGER project_customer_events_append_only BEFORE UPDATE OR DELETE ON tenant.project_customer_events FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  FOREACH name IN ARRAY ARRAY['project_customer_contacts', 'project_customer_sites', 'project_customer_change_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_no_delete' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete()', name || '_no_delete', name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['project_customer_contacts', 'project_customer_sites', 'project_customer_events', 'project_customer_change_requests'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_customer_contacts, tenant.project_customer_sites, tenant.project_customer_change_requests TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_customer_events TO vercent_app;
GRANT SELECT ON tenant.project_customer_contacts, tenant.project_customer_sites, tenant.project_customer_events, tenant.project_customer_change_requests TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.customer.view', 'View project customers', 'Projects', 'See a project''s customer details, contacts, sites and related sales records.'),
  ('projects.customer.assign', 'Assign project customers', 'Projects', 'Choose the customer of a draft project and search eligible customers.'),
  ('projects.customer.change', 'Change project customers', 'Projects', 'Request, approve and apply a customer change on a project past its draft.'),
  ('projects.customer.contacts.manage', 'Manage project customer contacts', 'Projects', 'Add, change and remove the customer''s contacts on a project.'),
  ('projects.customer.sales_link', 'Link project sales records', 'Projects', 'Link the customer''s opportunities, quotations, sales orders and invoices to a project.'),
  ('projects.customer.address.manage', 'Manage project sites', 'Projects', 'Set the sites and service locations where a project is delivered.'),
  ('projects.customer.history.view', 'View project customer history', 'Projects', 'See the history of a project''s customer association.'),
  ('projects.customer.export', 'Export project customers', 'Projects', 'Export project customer associations.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.customer.view'), ('project_manager', 'projects.customer.assign'), ('project_manager', 'projects.customer.change'),
    ('project_manager', 'projects.customer.contacts.manage'), ('project_manager', 'projects.customer.sales_link'), ('project_manager', 'projects.customer.address.manage'),
    ('project_manager', 'projects.customer.history.view'), ('project_manager', 'projects.customer.export'),
    ('employee', 'projects.customer.view'),
    ('sales_head', 'projects.customer.view'), ('sales_head', 'projects.customer.assign'), ('sales_head', 'projects.customer.sales_link'),
    ('sales_manager', 'projects.customer.view'), ('sales_manager', 'projects.customer.assign'), ('sales_manager', 'projects.customer.sales_link'),
    ('finance_manager', 'projects.customer.view'), ('finance_manager', 'projects.customer.history.view'), ('finance_manager', 'projects.customer.export'),
    ('accountant', 'projects.customer.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0126_projects_customer_association.sql', 'projects-customer-association') ON CONFLICT DO NOTHING;
