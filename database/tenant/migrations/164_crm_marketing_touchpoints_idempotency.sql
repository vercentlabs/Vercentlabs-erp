BEGIN;

-- Multi-touch attribution — activates the tenant.crm_marketing_touchpoints
-- table that migration 034 defined (with crm_campaigns.attribution_model:
-- first_touch/last_touch/linear/position_based/time_decay) but that no
-- application code has ever written to. content_hash already exists on the
-- table for this purpose; it just never had a uniqueness constraint, so
-- writers could not safely use ON CONFLICT DO NOTHING for idempotent
-- touchpoint recording (a lead capture retried after a network error, or a
-- webhook redelivery, must not double-count a touch).
CREATE UNIQUE INDEX IF NOT EXISTS crm_marketing_touchpoints_org_hash_uidx
  ON tenant.crm_marketing_touchpoints(organization_id, content_hash);

COMMIT;
