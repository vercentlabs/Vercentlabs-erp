BEGIN;

-- Repair any historical collision deterministically before enforcing the
-- organization-wide invariant. Lead-source rows and Lead foreign keys remain
-- untouched; only redundant default flags are cleared.
WITH ranked_defaults AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY organization_id
      ORDER BY is_system DESC, sort_order, created_at, id
    ) AS default_rank
  FROM tenant.crm_lead_sources
  WHERE is_default = true
    AND status = 'active'
    AND archived_at IS NULL
)
UPDATE tenant.crm_lead_sources source
SET is_default = false, updated_at = now()
FROM ranked_defaults ranked
WHERE source.id = ranked.id
  AND ranked.default_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sources_active_default_uidx
  ON tenant.crm_lead_sources(organization_id)
  WHERE is_default = true
    AND status = 'active'
    AND archived_at IS NULL;

COMMIT;
