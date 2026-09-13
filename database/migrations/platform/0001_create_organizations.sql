-- SP001: organization/tenant identity and lifecycle.
-- gen_random_uuid() is built into PostgreSQL core since v13 (no pgcrypto
-- extension required).
CREATE TABLE platform.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  legal_metadata JSONB,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  status_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CONSTRAINT organizations_tenant_key_key UNIQUE (tenant_key),
  CONSTRAINT organizations_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT organizations_tenant_key_format_check
    CHECK (tenant_key ~ '^[A-Z0-9](?:[A-Z0-9_-]{0,30}[A-Z0-9])?$'),
  CONSTRAINT organizations_display_name_not_blank_check
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT organizations_version_positive_check CHECK (version >= 1)
);

CREATE INDEX organizations_status_idx ON platform.organizations (status);

COMMENT ON TABLE platform.organizations IS
  'SP001 tenant identity and lifecycle. Immutable tenant_key; no physical delete - lifecycle transitions and CLOSED status represent end-of-life.';
