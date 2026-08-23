BEGIN;

ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS billing_webhook_recovery_idx
  ON billing_webhook_events(processing_status, processing_lease_expires_at)
  WHERE processing_status IN ('received', 'processing', 'failed');

WITH ranked_live_checkouts AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id
           ORDER BY created_at DESC, id DESC
         ) AS live_rank
    FROM billing_checkout_sessions
   WHERE status = 'created'
)
UPDATE billing_checkout_sessions checkout
   SET status = 'superseded',
       updated_at = now()
  FROM ranked_live_checkouts ranked
 WHERE checkout.id = ranked.id
   AND ranked.live_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_provider_subscription_uidx
  ON billing_checkout_sessions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_one_live_per_org_uidx
  ON billing_checkout_sessions(organization_id)
  WHERE status = 'created';

COMMIT;
