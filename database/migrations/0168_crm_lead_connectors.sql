-- CRM plan, step 3.3: leads from IndiaMART, JustDial and TradeIndia, and from Meta (Facebook / Instagram) and Google lead-form ads.
--
-- A connector belongs to the organization and names its provider, the source and owner its leads get, and its credentials (kept
-- encrypted). IndiaMART and TradeIndia are read on a schedule from their lead APIs; JustDial, Meta and Google send each lead to the
-- connector's own webhook address, whose key is the credential (only its hash is kept, as for inbound email). Every lead a provider
-- sends is recorded once by the provider's own lead id, with what became of it (a new lead, or logged on the person's existing lead or
-- contact), so a lead fetched twice or re-sent is never a second lead.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_connectors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('indiamart', 'justdial', 'tradeindia', 'meta', 'google')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  source_id uuid,
  owner_user_id uuid REFERENCES public.users(id),
  encrypted_credentials jsonb,
  webhook_key_hash character(64),
  webhook_key_prefix text,
  poll_interval_minutes integer NOT NULL DEFAULT 15 CHECK (poll_interval_minutes BETWEEN 5 AND 1440),
  last_polled_at timestamptz,
  polled_until timestamptz,
  last_received_at timestamptz,
  received_count integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_lead_connectors_name_uidx UNIQUE (organization_id, name),
  CONSTRAINT crm_lead_connectors_webhook_uidx UNIQUE (webhook_key_hash)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_connector_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  connector_id uuid NOT NULL REFERENCES tenant.crm_lead_connectors(id),
  external_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  enquiry_at timestamptz,
  status text NOT NULL CHECK (status IN ('created', 'logged', 'ignored', 'failed')),
  lead_id uuid,
  record_type text,
  record_id uuid,
  summary text,
  error_message text,
  CONSTRAINT crm_lead_connector_events_uidx UNIQUE (connector_id, external_id)
);
CREATE INDEX IF NOT EXISTS crm_lead_connector_events_recent_idx ON tenant.crm_lead_connector_events (organization_id, connector_id, received_at DESC);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_lead_connectors', 'crm_lead_connector_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_lead_connectors, tenant.crm_lead_connector_events TO vercent_app, vercent_worker;

-- A webhook's key resolves its organization before any organization context exists (as an inbound-mail route's does).
CREATE OR REPLACE FUNCTION tenant.crm_resolve_lead_connector(key_hash text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT connector.organization_id FROM tenant.crm_lead_connectors connector WHERE connector.webhook_key_hash = key_hash LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_resolve_lead_connector(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_resolve_lead_connector(text) TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0168_crm_lead_connectors.sql', 'crm-lead-connectors') ON CONFLICT DO NOTHING;
