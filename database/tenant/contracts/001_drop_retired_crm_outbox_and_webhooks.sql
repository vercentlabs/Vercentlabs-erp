BEGIN;

-- CONTRACT. The CRM outbox and CRM webhook subscriptions were migrated to the
-- Shared Platform (tenant migration 184: tenant.platform_events and
-- tenant.webhook_subscriptions, keeping the same ids) and are read and
-- written by nothing. Precondition: every row made it across.

DO $$
DECLARE
  missing_events integer := 0;
  missing_subscriptions integer := 0;
BEGIN
  IF to_regclass('tenant.crm_outbox_events') IS NOT NULL THEN
    SELECT count(*) INTO missing_events
      FROM tenant.crm_outbox_events old
     WHERE NOT EXISTS (SELECT 1 FROM tenant.platform_events event WHERE event.organization_id = old.organization_id AND event.id = old.id);
  END IF;
  IF to_regclass('tenant.crm_webhook_subscriptions') IS NOT NULL THEN
    SELECT count(*) INTO missing_subscriptions
      FROM tenant.crm_webhook_subscriptions old
     WHERE NOT EXISTS (SELECT 1 FROM tenant.webhook_subscriptions subscription WHERE subscription.organization_id = old.organization_id AND subscription.id = old.id);
  END IF;
  IF missing_events > 0 OR missing_subscriptions > 0 THEN
    RAISE EXCEPTION 'contract precondition failed: % outbox event(s) and % webhook subscription(s) were not migrated to the platform tables', missing_events, missing_subscriptions;
  END IF;
END
$$;

DROP TABLE IF EXISTS tenant.crm_outbox_events;
DROP TABLE IF EXISTS tenant.crm_webhook_subscriptions;

COMMIT;
