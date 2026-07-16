BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS active_organization_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sessions'::regclass
      AND conname = 'sessions_active_organization_id_fkey'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_active_organization_id_fkey
      FOREIGN KEY (active_organization_id)
      REFERENCES organizations(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_active_organization_id_fkey;
CREATE INDEX IF NOT EXISTS sessions_active_organization_idx
  ON sessions(user_id, active_organization_id)
  WHERE revoked_at IS NULL;

ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS payload_hash text;
CREATE INDEX IF NOT EXISTS billing_webhook_events_payload_hash_idx
  ON billing_webhook_events(payload_hash)
  WHERE payload_hash IS NOT NULL;

-- Composite tenant ownership keys used by all control-plane scope references.
CREATE UNIQUE INDEX IF NOT EXISTS companies_organization_id_id_uidx
  ON companies(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS branches_organization_id_id_uidx
  ON branches(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS departments_organization_id_id_uidx
  ON departments(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS roles_organization_id_id_uidx
  ON roles(organization_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'branches'::regclass
      AND conname = 'branches_organization_company_fkey'
  ) THEN
    ALTER TABLE branches
      ADD CONSTRAINT branches_organization_company_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES companies(organization_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE branches VALIDATE CONSTRAINT branches_organization_company_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership_company_access'::regclass
      AND conname = 'membership_company_access_organization_company_fkey'
  ) THEN
    ALTER TABLE membership_company_access
      ADD CONSTRAINT membership_company_access_organization_company_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES companies(organization_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE membership_company_access
  VALIDATE CONSTRAINT membership_company_access_organization_company_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership_branch_access'::regclass
      AND conname = 'membership_branch_access_organization_branch_fkey'
  ) THEN
    ALTER TABLE membership_branch_access
      ADD CONSTRAINT membership_branch_access_organization_branch_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES branches(organization_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE membership_branch_access
  VALIDATE CONSTRAINT membership_branch_access_organization_branch_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'membership_department_access'::regclass
      AND conname = 'membership_department_access_organization_department_fkey'
  ) THEN
    ALTER TABLE membership_department_access
      ADD CONSTRAINT membership_department_access_organization_department_fkey
      FOREIGN KEY (organization_id, department_id)
      REFERENCES departments(organization_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE membership_department_access
  VALIDATE CONSTRAINT membership_department_access_organization_department_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_role_assignments'::regclass
      AND conname = 'user_role_assignments_organization_role_fkey'
  ) THEN
    ALTER TABLE user_role_assignments
      ADD CONSTRAINT user_role_assignments_organization_role_fkey
      FOREIGN KEY (organization_id, role_id)
      REFERENCES roles(organization_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE user_role_assignments
  VALIDATE CONSTRAINT user_role_assignments_organization_role_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_preferences'::regclass
      AND conname = 'user_preferences_organization_company_fkey'
  ) THEN
    ALTER TABLE user_preferences
      ADD CONSTRAINT user_preferences_organization_company_fkey
      FOREIGN KEY (organization_id, active_company_id)
      REFERENCES companies(organization_id, id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;
ALTER TABLE user_preferences
  VALIDATE CONSTRAINT user_preferences_organization_company_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_preferences'::regclass
      AND conname = 'user_preferences_organization_branch_fkey'
  ) THEN
    ALTER TABLE user_preferences
      ADD CONSTRAINT user_preferences_organization_branch_fkey
      FOREIGN KEY (organization_id, active_branch_id)
      REFERENCES branches(organization_id, id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;
ALTER TABLE user_preferences
  VALIDATE CONSTRAINT user_preferences_organization_branch_fkey;

CREATE TABLE IF NOT EXISTS organization_invitation_company_access (
  invitation_id uuid NOT NULL REFERENCES organization_invitations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, company_id),
  FOREIGN KEY (organization_id, company_id)
    REFERENCES companies(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organization_invitation_branch_access (
  invitation_id uuid NOT NULL REFERENCES organization_invitations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, branch_id),
  FOREIGN KEY (organization_id, branch_id)
    REFERENCES branches(organization_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organization_invitation_department_access (
  invitation_id uuid NOT NULL REFERENCES organization_invitations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, department_id),
  FOREIGN KEY (organization_id, department_id)
    REFERENCES departments(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS organization_invitation_company_org_idx
  ON organization_invitation_company_access(organization_id, invitation_id);
CREATE INDEX IF NOT EXISTS organization_invitation_branch_org_idx
  ON organization_invitation_branch_access(organization_id, invitation_id);
CREATE INDEX IF NOT EXISTS organization_invitation_department_org_idx
  ON organization_invitation_department_access(organization_id, invitation_id);

-- Any privilege or scope change invalidates active sessions. The next login builds
-- a fresh context from current memberships and scope tables.
CREATE OR REPLACE FUNCTION revoke_sessions_after_access_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_user_id uuid;
BEGIN
  affected_user_id := COALESCE(NEW.user_id, OLD.user_id);
  UPDATE sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = COALESCE(revoked_reason, 'access_changed')
  WHERE user_id = affected_user_id
    AND revoked_at IS NULL;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION revoke_sessions_after_access_change() FROM PUBLIC;

DO $$
DECLARE
  relation_name text;
  trigger_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'organization_memberships',
    'user_role_assignments',
    'membership_company_access',
    'membership_branch_access',
    'membership_department_access'
  ]
  LOOP
    trigger_name := 'revoke_sessions_after_' || relation_name || '_change';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, relation_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION revoke_sessions_after_access_change()',
      trigger_name,
      relation_name
    );
  END LOOP;
END $$;

COMMIT;
