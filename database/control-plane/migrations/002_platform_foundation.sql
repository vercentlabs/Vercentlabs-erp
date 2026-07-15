BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND conname = 'users_status_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_status_check;
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'disabled', 'suspended')) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_status_check;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE companies ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE companies SET code = upper(left(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'), 6)) || '-' || upper(left(replace(id::text, '-', ''), 4)) WHERE code IS NULL;
ALTER TABLE companies ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS companies_org_code_uidx ON companies(organization_id, code);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_reason text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name text;
UPDATE sessions SET idle_expires_at = LEAST(expires_at, now() + interval '8 hours') WHERE idle_expires_at IS NULL;
ALTER TABLE sessions ALTER COLUMN idle_expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions(user_id, revoked_at, expires_at, idle_expires_at);

ALTER TABLE organization_invitations ADD COLUMN IF NOT EXISTS role_id uuid;
ALTER TABLE organization_invitations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE organization_invitations ADD COLUMN IF NOT EXISTS last_sent_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE organization_invitations ADD COLUMN IF NOT EXISTS send_count integer NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organization_invitations'::regclass
      AND conname = 'organization_invitations_role_check'
  ) THEN
    ALTER TABLE organization_invitations DROP CONSTRAINT organization_invitations_role_check;
  END IF;
END $$;

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS before_data jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS after_data jsonb;
CREATE INDEX IF NOT EXISTS audit_events_org_created_idx ON audit_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_event_type_idx ON audit_events(organization_id, event_type);

CREATE TABLE IF NOT EXISTS password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_history_user_idx ON password_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  succeeded boolean NOT NULL,
  reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_email_idx ON login_events(email, created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_user_idx ON login_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS permissions (
  key text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organization_invitations'::regclass
      AND conname = 'organization_invitations_role_id_fkey'
  ) THEN
    ALTER TABLE organization_invitations
      ADD CONSTRAINT organization_invitations_role_id_fkey
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS membership_company_access (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, company_id)
);

CREATE TABLE IF NOT EXISTS membership_branch_access (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS membership_department_access (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, department_id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  active_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  locale text NOT NULL DEFAULT 'en-IN',
  timezone text,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS numbering_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  prefix text NOT NULL,
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  padding integer NOT NULL DEFAULT 5 CHECK (padding BETWEEN 1 AND 12),
  fiscal_year_reset boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type)
);

CREATE TABLE IF NOT EXISTS organization_modules (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'enabled', 'disabled')),
  enabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, module_key)
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  entity_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS approval_requests_org_status_idx ON approval_requests(organization_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  file_name text NOT NULL,
  storage_key text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, field_key)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  entity_id text NOT NULL,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, definition_id, entity_id)
);

INSERT INTO permissions (key, name, category, description) VALUES
  ('workspace.view', 'View workspace', 'Workspace', 'Access the authenticated ERP workspace.'),
  ('organization.manage', 'Manage organisation', 'Organisation', 'Edit organisation settings and ownership.'),
  ('company.manage', 'Manage companies', 'Organisation', 'Create and maintain legal companies.'),
  ('branch.manage', 'Manage branches', 'Organisation', 'Create and maintain branches and locations.'),
  ('department.manage', 'Manage departments', 'Organisation', 'Create and maintain departments.'),
  ('cost_center.manage', 'Manage cost centres', 'Organisation', 'Create and maintain cost centres.'),
  ('team.manage', 'Manage teams', 'Organisation', 'Create and maintain operating teams.'),
  ('users.view', 'View users', 'Access', 'View organisation members and invitations.'),
  ('users.manage', 'Manage users', 'Access', 'Invite, disable and scope users.'),
  ('roles.manage', 'Manage roles', 'Access', 'Create roles and assign permissions.'),
  ('audit.view', 'View audit log', 'Governance', 'Review organisation audit events.'),
  ('notifications.view', 'View notifications', 'Workspace', 'View personal notifications.'),
  ('modules.manage', 'Manage modules', 'Platform', 'Manage the organisation module registry.'),
  ('numbering.manage', 'Manage numbering', 'Platform', 'Configure document numbering series.'),
  ('approvals.manage', 'Manage approvals', 'Governance', 'Review and decide approval requests.'),
  ('profile.manage', 'Manage profile', 'Account', 'Manage personal profile and preferences.'),
  ('sessions.manage', 'Manage sessions', 'Account', 'Review and revoke account sessions.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_seed(name, slug, description, is_system) AS (
  VALUES
    ('Organisation Owner', 'organization_owner', 'Full organisation ownership and governance.', true),
    ('System Administrator', 'system_administrator', 'Platform configuration and access administration.', true),
    ('Company Administrator', 'company_administrator', 'Company, branch and user administration.', true),
    ('Finance Manager', 'finance_manager', 'Finance governance and approvals.', true),
    ('Sales Manager', 'sales_manager', 'Sales team governance and approvals.', true),
    ('Purchase Manager', 'purchase_manager', 'Procurement governance and approvals.', true),
    ('Inventory Manager', 'inventory_manager', 'Stock and warehouse governance.', true),
    ('Manufacturing Manager', 'manufacturing_manager', 'Production governance.', true),
    ('HR Manager', 'hr_manager', 'People and payroll governance.', true),
    ('Employee', 'employee', 'Standard employee workspace access.', true),
    ('Auditor', 'auditor', 'Read-only governance and audit access.', true),
    ('Read-only User', 'read_only', 'Read-only workspace access.', true)
)
INSERT INTO roles (organization_id, name, slug, description, is_system)
SELECT o.id, rs.name, rs.slug, rs.description, rs.is_system
FROM organizations o CROSS JOIN role_seed rs
ON CONFLICT (organization_id, slug) DO NOTHING;

UPDATE organization_invitations i
SET role_id = r.id
FROM roles r
WHERE i.organization_id = r.organization_id
  AND i.role_id IS NULL
  AND r.slug = CASE i.role WHEN 'admin' THEN 'system_administrator' ELSE 'employee' END;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
JOIN permissions p ON
  r.slug IN ('organization_owner', 'system_administrator')
  OR (r.slug = 'company_administrator' AND p.key <> 'organization.manage')
  OR (r.slug IN ('finance_manager', 'sales_manager', 'purchase_manager', 'inventory_manager', 'manufacturing_manager', 'hr_manager')
      AND p.key IN ('workspace.view', 'notifications.view', 'profile.manage', 'approvals.manage'))
  OR (r.slug = 'employee' AND p.key IN ('workspace.view', 'notifications.view', 'profile.manage'))
  OR (r.slug = 'auditor' AND p.key IN ('workspace.view', 'audit.view', 'notifications.view', 'profile.manage'))
  OR (r.slug = 'read_only' AND p.key IN ('workspace.view', 'notifications.view', 'profile.manage'))
ON CONFLICT DO NOTHING;

INSERT INTO user_role_assignments (organization_id, user_id, role_id, assigned_by)
SELECT m.organization_id, m.user_id, r.id, o.created_by
FROM organization_memberships m
JOIN organizations o ON o.id = m.organization_id
JOIN roles r ON r.organization_id = m.organization_id
 AND r.slug = CASE m.role
   WHEN 'owner' THEN 'organization_owner'
   WHEN 'admin' THEN 'system_administrator'
   ELSE 'employee'
 END
ON CONFLICT DO NOTHING;

INSERT INTO membership_company_access (organization_id, user_id, company_id)
SELECT m.organization_id, m.user_id, c.id
FROM organization_memberships m
JOIN companies c ON c.organization_id = m.organization_id
ON CONFLICT DO NOTHING;

INSERT INTO membership_branch_access (organization_id, user_id, branch_id)
SELECT m.organization_id, m.user_id, b.id
FROM organization_memberships m
JOIN branches b ON b.organization_id = m.organization_id
ON CONFLICT DO NOTHING;

INSERT INTO membership_department_access (organization_id, user_id, department_id)
SELECT m.organization_id, m.user_id, d.id
FROM organization_memberships m
JOIN departments d ON d.organization_id = m.organization_id
ON CONFLICT DO NOTHING;

INSERT INTO user_preferences (organization_id, user_id, active_company_id, active_branch_id, timezone)
SELECT m.organization_id, m.user_id, c.id, b.id, o.timezone
FROM organization_memberships m
JOIN organizations o ON o.id = m.organization_id
LEFT JOIN companies c ON c.organization_id = m.organization_id AND c.is_primary = true
LEFT JOIN branches b ON b.organization_id = m.organization_id AND b.is_primary = true
ON CONFLICT (organization_id, user_id) DO NOTHING;

WITH module_seed(module_key, name) AS (
  VALUES
    ('accounting', 'Accounting'), ('procurement', 'Procurement'),
    ('sales', 'Sales'), ('crm', 'CRM'), ('stock', 'Stock'),
    ('manufacturing', 'Manufacturing'), ('projects', 'Projects'),
    ('assets', 'Assets'), ('point-of-sale', 'Point of Sale'),
    ('quality', 'Quality'), ('support', 'Support'), ('hr-payroll', 'HR & Payroll')
)
INSERT INTO organization_modules (organization_id, module_key, name)
SELECT o.id, m.module_key, m.name FROM organizations o CROSS JOIN module_seed m
ON CONFLICT DO NOTHING;

WITH series_seed(entity_type, prefix) AS (
  VALUES ('customer', 'CUS-'), ('supplier', 'SUP-'), ('quotation', 'QUO-'),
         ('sales_order', 'SO-'), ('purchase_order', 'PO-'), ('invoice', 'INV-'),
         ('employee', 'EMP-'), ('asset', 'AST-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT o.id, s.entity_type, s.prefix FROM organizations o CROSS JOIN series_seed s
ON CONFLICT DO NOTHING;

UPDATE organizations SET onboarding_completed_at = COALESCE(onboarding_completed_at, created_at);

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable_update ON audit_events;
CREATE TRIGGER audit_events_immutable_update
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

COMMIT;
