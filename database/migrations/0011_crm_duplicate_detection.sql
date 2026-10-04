-- CRM Duplicate Detection: the decisions people make about duplicates.
--
-- Matching itself needs no tables: it runs on the normalized columns the
-- lead, contact and account tables already maintain. This migration adds
-- what must be remembered:
--
--   0. Phone comparison — numbers compare on their national part, so
--      "+91 98765 43210" and "9876543210" are the same number
--   1. Duplicate decisions — "create anyway" overrides (who, why, against
--      which record) and "these two are not duplicates" exclusions
--   2. Row-level security and grants
--   3. Permissions
--
-- A merged lead points to the lead it was merged into (merged accounts and
-- contacts are remembered in tenant.crm_entity_merge_aliases, as before).
--
-- Run once, after 0010_crm_lead_stages.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 0. phone comparison
-- The comparable form of a phone number is its last ten digits: the country
-- code and the trunk zero are how the number was typed, not who it reaches.
-- The value the user entered is stored untouched.

CREATE OR REPLACE FUNCTION tenant.crm_normalize_phone(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $function$
  SELECT NULLIF(right(regexp_replace(COALESCE(value, ''), '[^0-9]+', '', 'g'), 10), '')
$function$;

-- The stored comparison columns are recalculated with the new rule.
UPDATE tenant.crm_leads SET mobile = mobile WHERE mobile IS NOT NULL OR phone IS NOT NULL;
UPDATE tenant.contacts SET mobile = mobile WHERE mobile IS NOT NULL OR phone IS NOT NULL OR alternate_phone IS NOT NULL;

-- ============================================================ 1. duplicate decisions

CREATE TABLE tenant.crm_duplicate_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- override: record A was saved although it matched record B
  -- not_duplicate: A and B were reviewed and are different; do not warn about this pair again
  decision text NOT NULL,
  record_type_a text NOT NULL,
  record_id_a uuid NOT NULL,
  record_type_b text NOT NULL,
  record_id_b uuid NOT NULL,
  match_strength text,
  matched_fields text[] DEFAULT '{}'::text[] NOT NULL,
  reason text,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_duplicate_decisions_decision_check CHECK (decision = ANY (ARRAY['override', 'not_duplicate'])),
  CONSTRAINT crm_duplicate_decisions_type_check CHECK (
    record_type_a = ANY (ARRAY['lead', 'contact', 'account']) AND record_type_b = ANY (ARRAY['lead', 'contact', 'account'])),
  CONSTRAINT crm_duplicate_decisions_pair_check CHECK (record_type_a <> record_type_b OR record_id_a <> record_id_b),
  CONSTRAINT crm_duplicate_decisions_reason_check CHECK (reason IS NULL OR char_length(reason) <= 500)
);
-- A pair is excluded once, whichever way round it was marked.
CREATE UNIQUE INDEX crm_duplicate_decisions_pair_uidx ON tenant.crm_duplicate_decisions (
  organization_id,
  LEAST(record_type_a || ':' || record_id_a::text, record_type_b || ':' || record_id_b::text),
  GREATEST(record_type_a || ':' || record_id_a::text, record_type_b || ':' || record_id_b::text)
) WHERE decision = 'not_duplicate';
CREATE INDEX crm_duplicate_decisions_a_idx ON tenant.crm_duplicate_decisions (organization_id, record_type_a, record_id_a);
CREATE INDEX crm_duplicate_decisions_b_idx ON tenant.crm_duplicate_decisions (organization_id, record_type_b, record_id_b);

-- The lead a merged duplicate became. Its page points here instead of dead-ending.
ALTER TABLE tenant.crm_leads ADD COLUMN merged_into_lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL;
CREATE INDEX crm_leads_merged_into_idx ON tenant.crm_leads (organization_id, merged_into_lead_id) WHERE merged_into_lead_id IS NOT NULL;

CREATE INDEX crm_entity_merge_aliases_source_idx ON tenant.crm_entity_merge_aliases (organization_id, entity_type, source_entity_id);

-- ============================================================ 2. row-level security and grants

ALTER TABLE tenant.crm_duplicate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_duplicate_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_duplicate_decisions USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

-- An exclusion can be withdrawn (DELETE); an override is a record of what happened.
GRANT SELECT, INSERT, DELETE ON TABLE tenant.crm_duplicate_decisions TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_duplicate_decisions TO vercent_worker;

-- ============================================================ 3. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.duplicates.override', 'Override duplicate warnings', 'CRM', 'Save a lead, contact or account although it strongly matches an existing record, with a reason.'),
  ('crm.duplicates.review', 'Review duplicates', 'CRM', 'Open the duplicate review queue and mark two records as not duplicates.'),
  ('crm.leads.merge', 'Merge leads', 'CRM', 'Merge a duplicate lead into the lead that is kept.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist: managers and administrators get them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.duplicates.override', 'crm.duplicates.review', 'crm.leads.merge'])
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'marketing_manager', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0011_crm_duplicate_detection.sql', 'crm-duplicate-detection');
