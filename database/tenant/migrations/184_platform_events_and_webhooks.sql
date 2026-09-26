BEGIN;

-- Shared Platform outbox + webhooks (Prompt 5).
--
-- tenant.platform_events       the generic transactional outbox: written in
--                              the same transaction as the business change,
--                              stable id, fanned out by the worker.
-- tenant.webhook_subscriptions organisation webhooks for REGISTERED event
--                              types, each with its own encrypted signing
--                              secret (NULL only for subscriptions migrated
--                              from CRM before secrets existed; they deliver
--                              unsigned until an administrator rotates one).
-- tenant.webhook_deliveries    one row per (event, subscription): its own
--                              status, attempts, lease and last error, so a
--                              retry for one endpoint never re-sends to
--                              another that already succeeded.
-- The CRM tables (crm_outbox_events, crm_webhook_subscriptions) are left in
-- place as history; nothing writes or reads them after this migration.

CREATE TABLE IF NOT EXISTS tenant.platform_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  module_key text NOT NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  dispatch_status text NOT NULL DEFAULT 'pending' CHECK (dispatch_status IN ('pending', 'dispatched')),
  dispatched_at timestamptz,
  legacy_source text
);
CREATE INDEX IF NOT EXISTS platform_events_pending_idx ON tenant.platform_events (organization_id, occurred_at, id) WHERE dispatch_status = 'pending';
CREATE INDEX IF NOT EXISTS platform_events_entity_idx ON tenant.platform_events (organization_id, entity_type, entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tenant.webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  endpoint_url text NOT NULL,
  event_types text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  encrypted_signing_secret jsonb,
  secret_version integer NOT NULL DEFAULT 1,
  secret_rotated_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  legacy_source text
);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_org_idx ON tenant.webhook_subscriptions (organization_id, status);

CREATE TABLE IF NOT EXISTS tenant.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES tenant.platform_events(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES tenant.webhook_subscriptions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  last_status_code integer,
  response_summary text,
  delivered_at timestamptz,
  redelivery_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON tenant.webhook_deliveries (organization_id, next_attempt_at) WHERE status IN ('pending', 'retry', 'processing');
CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_idx ON tenant.webhook_deliveries (organization_id, subscription_id, created_at DESC);

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['platform_events', 'webhook_subscriptions', 'webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = target AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', target);
    END IF;
  END LOOP;
END $$;

-- CRM subscriptions -> platform subscriptions (same ids; inactive -> disabled).
INSERT INTO tenant.webhook_subscriptions (id, organization_id, name, endpoint_url, event_types, status, created_by, updated_by, created_at, updated_at, legacy_source)
SELECT id, organization_id, name, endpoint_url, event_types, CASE WHEN status = 'active' THEN 'active' ELSE 'disabled' END,
       created_by, updated_by, created_at, updated_at, 'crm_webhook_subscriptions'
  FROM tenant.crm_webhook_subscriptions
ON CONFLICT (id) DO NOTHING;

-- CRM outbox rows -> platform events (same ids). Rows the CRM worker had not
-- finished (pending/processing/failed) become pending events and are delivered
-- by the new pipeline; finished rows (delivered/dead_letter) are history.
INSERT INTO tenant.platform_events (id, organization_id, module_key, event_type, entity_type, entity_id, payload, occurred_at, dispatch_status, dispatched_at, legacy_source)
SELECT id, organization_id, 'crm', event_type, entity_type, entity_id::text, payload, created_at,
       CASE WHEN status IN ('delivered', 'dead_letter') THEN 'dispatched' ELSE 'pending' END,
       CASE WHEN status IN ('delivered', 'dead_letter') THEN COALESCE(delivered_at, updated_at) END,
       'crm_outbox_events'
  FROM tenant.crm_outbox_events
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE tenant.crm_outbox_events IS 'RETIRED (tenant migration 184): migrated to tenant.platform_events. Read and written by nothing; removed in Prompt 6.';
COMMENT ON TABLE tenant.crm_webhook_subscriptions IS 'RETIRED (tenant migration 184): migrated to tenant.webhook_subscriptions. Read and written by nothing; removed in Prompt 6.';

COMMIT;
