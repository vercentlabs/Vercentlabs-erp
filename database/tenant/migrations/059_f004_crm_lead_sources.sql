BEGIN;

-- F004 extends the existing organization-wide source catalogue in place.
-- Lead references remain stable; lifecycle changes never delete source rows.
ALTER TABLE tenant.crm_lead_sources
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE tenant.crm_lead_sources
SET
  is_system = true,
  sort_order = CASE code
    WHEN 'WEBSITE' THEN 10
    WHEN 'REFERRAL' THEN 20
    WHEN 'PARTNER' THEN 30
    WHEN 'EVENT' THEN 40
    WHEN 'PHONE' THEN 50
    WHEN 'WALK_IN' THEN 60
    WHEN 'IMPORT' THEN 70
    WHEN 'OTHER' THEN 80
    ELSE sort_order
  END
WHERE code IN ('WEBSITE','REFERRAL','PARTNER','EVENT','PHONE','WALK_IN','IMPORT','OTHER');

-- Earlier generic configuration allowed names that differed only by case or
-- surrounding whitespace. Keep every row and FK intact while making any such
-- historical collision distinguishable before enforcing canonical uniqueness.
WITH ranked AS (
  SELECT id, code,
    row_number() OVER (
      PARTITION BY organization_id, lower(btrim(name))
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM tenant.crm_lead_sources
)
UPDATE tenant.crm_lead_sources source
SET name = btrim(source.name) || ' (' || source.code || ')', updated_at = now()
FROM ranked
WHERE ranked.id = source.id AND ranked.duplicate_rank > 1;

ALTER TABLE tenant.crm_lead_sources
  DROP CONSTRAINT IF EXISTS crm_lead_sources_name_check,
  ADD CONSTRAINT crm_lead_sources_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  DROP CONSTRAINT IF EXISTS crm_lead_sources_description_check,
  ADD CONSTRAINT crm_lead_sources_description_check
    CHECK (description IS NULL OR char_length(description) <= 500),
  DROP CONSTRAINT IF EXISTS crm_lead_sources_sort_order_check,
  ADD CONSTRAINT crm_lead_sources_sort_order_check
    CHECK (sort_order BETWEEN 0 AND 10000);

CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sources_normalized_name_uidx
  ON tenant.crm_lead_sources(organization_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS crm_lead_sources_catalogue_idx
  ON tenant.crm_lead_sources(
    organization_id,
    status,
    sort_order,
    lower(name),
    id
  );

COMMIT;
