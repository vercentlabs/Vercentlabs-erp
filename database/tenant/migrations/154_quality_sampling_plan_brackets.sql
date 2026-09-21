BEGIN;

-- An AQL sampling plan is a FAMILY of lot-size brackets sharing one code (e.g. "AQL65" covers 1-50,
-- 51-500, 501-3200, ...); the original per-code uniqueness from migration 153 only allowed one bracket
-- per code, which is not how AQL tables work. Scope uniqueness to (code, lot_size_from) instead.
ALTER TABLE tenant.quality_sampling_plans DROP CONSTRAINT IF EXISTS quality_sampling_plans_organization_id_company_id_code_key;
ALTER TABLE tenant.quality_sampling_plans ADD CONSTRAINT quality_sampling_plans_code_bracket_key UNIQUE (organization_id, company_id, code, lot_size_from);

COMMIT;
