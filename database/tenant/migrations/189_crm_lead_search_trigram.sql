BEGIN;

-- F001 lead search at volume. The list search matched each column with
-- COALESCE(col::text,'') ILIKE '%term%', which no index can serve (about
-- 165-195 ms per statement at 10,000 leads, twice per request). Search now
-- matches one lower-cased text built from the searchable columns, backed by a
-- trigram index. Two variants: with contact details (email/phone/mobile) for
-- viewers of sensitive lead content, and without them for everyone else, so
-- a restricted viewer can never find a lead by a value they cannot see.
CREATE INDEX IF NOT EXISTS crm_leads_search_trgm_full_idx
  ON tenant.crm_leads USING gin ((lower(coalesce(code, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(full_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(mobile, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(product_interest, ''))) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crm_leads_search_trgm_restricted_idx
  ON tenant.crm_leads USING gin ((lower(coalesce(code, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(full_name, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(product_interest, ''))) public.gin_trgm_ops);

COMMIT;
