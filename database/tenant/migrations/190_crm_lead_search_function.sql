BEGIN;

-- F001 lead search under forced row-level security. LIKE is not leakproof, so
-- when it runs as the restricted runtime role Postgres must apply the RLS
-- predicate first and cannot drive the scan from the trigram indexes of
-- migration 190. This function returns the ids of leads IN THE CURRENT
-- ORGANISATION (the same app.current_organization_id setting the RLS policy
-- uses) whose searchable text matches, using those indexes. It returns ids
-- only; the caller's query still applies company, branch, owner/team and
-- sensitive-content scope to every row. EXECUTE is granted per runtime role
-- (packages/database/src/table-classification.js DEFINER_FUNCTIONS).
CREATE OR REPLACE FUNCTION tenant.crm_lead_search_ids(search_pattern text, include_contact_details boolean)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT lead.id FROM tenant.crm_leads lead
   WHERE include_contact_details
     AND lead.organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
     AND lower(coalesce(lead.code, '') || ' ' || coalesce(lead.first_name, '') || ' ' || coalesce(lead.last_name, '') || ' ' || coalesce(lead.full_name, '') || ' ' || coalesce(lead.email, '') || ' ' || coalesce(lead.phone, '') || ' ' || coalesce(lead.mobile, '') || ' ' || coalesce(lead.company_name, '') || ' ' || coalesce(lead.product_interest, '')) LIKE search_pattern
  UNION ALL
  SELECT lead.id FROM tenant.crm_leads lead
   WHERE NOT include_contact_details
     AND lead.organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
     AND lower(coalesce(lead.code, '') || ' ' || coalesce(lead.first_name, '') || ' ' || coalesce(lead.last_name, '') || ' ' || coalesce(lead.full_name, '') || ' ' || coalesce(lead.company_name, '') || ' ' || coalesce(lead.product_interest, '')) LIKE search_pattern
$$;
REVOKE ALL ON FUNCTION tenant.crm_lead_search_ids(text, boolean) FROM PUBLIC;

COMMIT;
