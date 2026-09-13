-- SP002: company/legal-entity structure, nested under an organization.
CREATE TABLE platform.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations (id) ON DELETE RESTRICT,
  company_code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  base_currency CHAR(3) NOT NULL,
  time_zone TEXT NOT NULL,
  tax_registrations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  status_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CONSTRAINT companies_org_code_key UNIQUE (organization_id, company_code),
  CONSTRAINT companies_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED')),
  CONSTRAINT companies_code_format_check
    CHECK (company_code ~ '^[A-Z0-9](?:[A-Z0-9_-]{0,30}[A-Z0-9])?$'),
  CONSTRAINT companies_country_format_check CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT companies_currency_format_check CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT companies_legal_name_not_blank_check CHECK (btrim(legal_name) <> ''),
  CONSTRAINT companies_version_positive_check CHECK (version >= 1)
);

CREATE INDEX companies_organization_id_idx ON platform.companies (organization_id);
CREATE INDEX companies_status_idx ON platform.companies (status);

COMMENT ON TABLE platform.companies IS
  'SP002 company/legal-entity structure. company_code is immutable and unique within its organization; no physical delete.';
