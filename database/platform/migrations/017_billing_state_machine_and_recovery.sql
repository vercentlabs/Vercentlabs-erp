BEGIN;

DO $$
DECLARE
  duplicate_provider text;
BEGIN
  SELECT provider_subscription_id
    INTO duplicate_provider
    FROM billing_checkout_sessions
   WHERE provider_subscription_id IS NOT NULL
   GROUP BY provider, provider_subscription_id
  HAVING count(*) > 1
   LIMIT 1;

  IF duplicate_provider IS NOT NULL THEN
    RAISE EXCEPTION
      'Billing migration blocked: duplicate checkout provider subscription id % must be reconciled first.',
      duplicate_provider;
  END IF;

  SELECT provider_subscription_id
    INTO duplicate_provider
    FROM organization_subscriptions
   WHERE provider_subscription_id IS NOT NULL
   GROUP BY provider, provider_subscription_id
  HAVING count(*) > 1
   LIMIT 1;

  IF duplicate_provider IS NOT NULL THEN
    RAISE EXCEPTION
      'Billing migration blocked: duplicate organization provider subscription id % must be reconciled first.',
      duplicate_provider;
  END IF;
END $$;

ALTER TABLE billing_checkout_sessions
  ADD COLUMN IF NOT EXISTS provider_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS recovery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_recovery_at timestamptz;

ALTER TABLE billing_checkout_sessions
  DROP CONSTRAINT IF EXISTS billing_checkout_sessions_status_check;

ALTER TABLE billing_checkout_sessions
  ADD CONSTRAINT billing_checkout_sessions_status_check
  CHECK (
    status IN (
      'created',
      'provider_creating',
      'provider_link_pending',
      'provider_recovery_pending',
      'verifying',
      'authorised',
      'failed',
      'failed_before_provider',
      'expired',
      'superseded',
      'cancel_pending',
      'cancelled'
    )
  );

UPDATE billing_checkout_sessions
   SET status = CASE
         WHEN provider_subscription_id IS NULL THEN 'failed_before_provider'
         ELSE 'provider_recovery_pending'
       END,
       next_recovery_at = CASE
         WHEN provider_subscription_id IS NOT NULL THEN now()
         ELSE NULL
       END,
       updated_at = now()
 WHERE status = 'failed';

DROP INDEX IF EXISTS billing_checkout_one_live_per_org_uidx;
CREATE UNIQUE INDEX billing_checkout_one_live_per_org_uidx
  ON billing_checkout_sessions(organization_id)
  WHERE status IN (
    'created',
    'provider_creating',
    'provider_link_pending',
    'provider_recovery_pending',
    'verifying'
  );

CREATE INDEX IF NOT EXISTS billing_checkout_recovery_due_idx
  ON billing_checkout_sessions(next_recovery_at)
  WHERE status = 'provider_recovery_pending';

ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS signature_value text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

ALTER TABLE billing_webhook_events
  DROP CONSTRAINT IF EXISTS billing_webhook_events_processing_status_check;

ALTER TABLE billing_webhook_events
  ADD CONSTRAINT billing_webhook_events_processing_status_check
  CHECK (
    processing_status IN (
      'received',
      'processing',
      'processed',
      'ignored',
      'failed',
      'dead_lettered'
    )
  );

UPDATE billing_webhook_events
   SET next_attempt_at = COALESCE(next_attempt_at, now())
 WHERE processing_status = 'failed'
   AND next_attempt_at IS NULL;

DROP INDEX IF EXISTS billing_webhook_recovery_idx;
CREATE INDEX billing_webhook_recovery_idx
  ON billing_webhook_events(processing_status, next_attempt_at, processing_lease_expires_at)
  WHERE processing_status IN ('received', 'processing', 'failed');

COMMIT;
