BEGIN;

-- CRM vNext Prompt 3 continuation: F008-PERF-001 requires bounded read
-- latency and "indexes appropriate to access patterns"; the pre-existing
-- findAccountDuplicates/findContactDuplicates ran an unindexed
-- regexp_replace(lower(...)) comparison directly in the WHERE clause — a
-- full table scan on every duplicate check. Mirrors the STORED generated
-- column + index pattern crm_leads already uses
-- (064_crm_lead_duplicate_detection_f008.sql), reusing the same
-- tenant.crm_normalize_email/crm_normalize_phone/crm_normalize_comparison_text
-- functions rather than inventing new normalization rules.
--
-- pg_trgm backs the new bounded, explainable fuzzy-similarity comparison
-- (character-trigram similarity — deterministic and inspectable, not an
-- opaque AI/ML dependency) used for normalized-name fuzzy matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE tenant.business_parties
  ADD COLUMN IF NOT EXISTS normalized_legal_name text
    GENERATED ALWAYS AS (
      tenant.crm_normalize_comparison_text(COALESCE(legal_name, display_name))
    ) STORED,
  ADD COLUMN IF NOT EXISTS normalized_pan text
    GENERATED ALWAYS AS (NULLIF(upper(btrim(pan)), '')) STORED;

CREATE INDEX IF NOT EXISTS business_parties_f008_legal_name_idx
  ON tenant.business_parties(organization_id, normalized_legal_name, status)
  WHERE normalized_legal_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_parties_f008_legal_name_trgm_idx
  ON tenant.business_parties USING gin (normalized_legal_name gin_trgm_ops)
  WHERE normalized_legal_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_parties_f008_pan_idx
  ON tenant.business_parties(organization_id, normalized_pan, status)
  WHERE normalized_pan IS NOT NULL;

ALTER TABLE tenant.contacts
  ADD COLUMN IF NOT EXISTS normalized_email text
    GENERATED ALWAYS AS (tenant.crm_normalize_email(email)) STORED,
  ADD COLUMN IF NOT EXISTS normalized_mobile text
    GENERATED ALWAYS AS (tenant.crm_normalize_phone(COALESCE(mobile, phone))) STORED,
  ADD COLUMN IF NOT EXISTS normalized_name text
    GENERATED ALWAYS AS (
      tenant.crm_normalize_comparison_text(btrim(first_name || ' ' || COALESCE(last_name, '')))
    ) STORED;

CREATE INDEX IF NOT EXISTS contacts_f008_email_idx
  ON tenant.contacts(organization_id, normalized_email, status)
  WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_f008_mobile_idx
  ON tenant.contacts(organization_id, normalized_mobile, status)
  WHERE normalized_mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_f008_name_trgm_idx
  ON tenant.contacts USING gin (normalized_name gin_trgm_ops)
  WHERE normalized_name IS NOT NULL;

COMMIT;
