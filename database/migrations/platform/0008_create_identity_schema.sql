-- Prompt 002B: SP004 identity and user lifecycle.
--
-- `identity` is deliberately its own schema, separate from `platform`
-- (tenant/company/unit structure) and `auth` (credentials/sessions/MFA,
-- see 0009-0011): a person's identity is global - one login identity can
-- belong to many organizations without duplicate accounts - so it must
-- never be modeled as a child of any single organization.
CREATE SCHEMA IF NOT EXISTS identity;

-- ---------------------------------------------------------------------
-- identity.users - the global identity record. No roles/permissions here
-- at all (SP008 owns that); no isAdmin/isPlatformAdmin boolean either.
-- ---------------------------------------------------------------------
CREATE TABLE identity.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'INVITED',
  status_reason TEXT,
  display_name TEXT,
  -- Regenerated whenever a security-relevant change occurs (password
  -- change, MFA reset, suspension, ...). Sessions carry the stamp value
  -- active at their own creation time; a mismatch means "this session
  -- predates a security change" even if it was never explicitly revoked -
  -- see auth.sessions and docs/architecture/session-model.md.
  security_stamp UUID NOT NULL DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  reactivated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CONSTRAINT users_status_check
    CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  CONSTRAINT users_version_positive_check CHECK (version >= 1)
);

CREATE INDEX users_status_idx ON identity.users (status);

COMMENT ON TABLE identity.users IS
  'SP004 global identity, separate from tenant membership. Immutable id. Account lockout from authentication defence (see auth.authentication_attempts) is intentionally NOT modeled here - it is a temporary, time-windowed condition, never a lifecycle status.';

-- ---------------------------------------------------------------------
-- identity.user_email_addresses - email is verified per-address, not
-- assumed. Uniqueness is GLOBAL (one email cannot belong to two identities)
-- since identity itself is global.
-- ---------------------------------------------------------------------
CREATE TABLE identity.user_email_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  -- Normalization policy (see docs/architecture/identity-model.md): the
  -- whole address lowercased and trimmed. Deliberately NOT provider-specific
  -- (no Gmail dot-removal, no plus-addressing collapse) - those are
  -- heuristics, not part of the email address's actual identity per RFC
  -- 5321/5322, and applying them would make two genuinely different
  -- mailboxes collide.
  email_normalized TEXT NOT NULL,
  email_original TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_email_addresses_email_normalized_key UNIQUE (email_normalized),
  CONSTRAINT user_email_addresses_email_normalized_not_blank_check
    CHECK (btrim(email_normalized) <> '')
);

CREATE INDEX user_email_addresses_user_id_idx ON identity.user_email_addresses (user_id);

-- Exactly one primary address per user (partial unique index, not a
-- boolean-plus-application-check, so the database itself cannot end up
-- with two primaries no matter which code path writes this table).
CREATE UNIQUE INDEX user_email_addresses_one_primary_per_user_idx
  ON identity.user_email_addresses (user_id)
  WHERE is_primary;

COMMENT ON TABLE identity.user_email_addresses IS
  'SP004 email ownership and verification. Global uniqueness on email_normalized - one mailbox, one identity.';

-- ---------------------------------------------------------------------
-- identity.organization_memberships - links a global identity to a
-- tenant. Carries no roles/permissions (SP008 owns that) - only whether
-- the person currently belongs to the organization at all.
-- ---------------------------------------------------------------------
CREATE TABLE identity.organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  organization_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CONSTRAINT organization_memberships_user_org_key UNIQUE (user_id, organization_id),
  CONSTRAINT organization_memberships_status_check
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  CONSTRAINT organization_memberships_version_positive_check CHECK (version >= 1)
);

CREATE INDEX organization_memberships_user_id_idx ON identity.organization_memberships (user_id);
CREATE INDEX organization_memberships_organization_id_idx ON identity.organization_memberships (organization_id);

COMMENT ON TABLE identity.organization_memberships IS
  'SP004 membership only - does not grant any permission. SP008 owns roles/permissions layered on top of an ACTIVE membership.';

-- ---------------------------------------------------------------------
-- identity.user_invitations - scoped to exactly one organization and one
-- intended email identity. Token is random and hashed at rest; the row is
-- looked up by that hash the same way a password-reset token is (capability
-- possession is the access control), never listed/browsed in this prompt.
-- ---------------------------------------------------------------------
CREATE TABLE identity.user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  invited_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES identity.users (id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT user_invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_invitations_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT user_invitations_version_positive_check CHECK (version >= 1)
);

CREATE INDEX user_invitations_organization_id_idx ON identity.user_invitations (organization_id);
CREATE INDEX user_invitations_email_normalized_idx ON identity.user_invitations (email_normalized);

COMMENT ON TABLE identity.user_invitations IS
  'SP004 invitations - single-use, expiring, hashed tokens. Scoped to one organization and one intended email. Acceptance is concurrency-safe via a conditional UPDATE ... WHERE status = PENDING.';

-- ---------------------------------------------------------------------
-- identity.user_lifecycle_history - append-only. No physical delete of a
-- user may ever remove this evidence.
-- ---------------------------------------------------------------------
CREATE TABLE identity.user_lifecycle_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_lifecycle_history_user_id_idx ON identity.user_lifecycle_history (user_id);

COMMENT ON TABLE identity.user_lifecycle_history IS
  'SP004 append-only lifecycle transition history, independent of audit.audit_events, kept queryable per-user without joining the shared cross-module audit log.';
