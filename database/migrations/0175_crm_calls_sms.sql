-- CRM plan, step 4.4: click-to-call with call logs, and SMS with DLT templates.
--
-- 1. Telephony (Exotel): "Call" on a record rings the salesperson's own phone first, then connects the customer through the
--    organization's virtual number; the provider's callback records the outcome, duration and recording, and the call is logged on the
--    record. Each salesperson keeps the number their calls ring (crm_call_agents).
-- 2. SMS (Exotel or MSG91): sent only from templates registered on DLT (TRAI) — the template's DLT id and the registered sender ID
--    (header) — with its {#var#} values filled in; promotional ones only to someone who agreed to SMS. Each message is kept with its
--    delivery status and logged on the record.
CREATE TABLE IF NOT EXISTS tenant.crm_telephony_settings (
  organization_id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'exotel')),
  account_sid text,
  api_host text,
  caller_id text,
  record_calls boolean NOT NULL DEFAULT true,
  encrypted_credentials jsonb,
  webhook_key_hash character(64) UNIQUE,
  webhook_key_prefix text,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.crm_call_agents (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  phone text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS tenant.crm_calls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact')),
  entity_id uuid NOT NULL,
  provider text NOT NULL,
  provider_call_id text,
  agent_user_id uuid REFERENCES public.users(id),
  agent_phone text,
  customer_phone text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  activity_id uuid,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_calls_provider_uidx ON tenant.crm_calls (organization_id, provider, provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_calls_record_idx ON tenant.crm_calls (organization_id, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_sms_settings (
  organization_id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'exotel', 'msg91')),
  sender_id text CHECK (sender_id IS NULL OR sender_id ~ '^[A-Z0-9]{3,11}$'),
  dlt_entity_id text,
  account_sid text,
  api_host text,
  encrypted_credentials jsonb,
  webhook_key_hash character(64) UNIQUE,
  webhook_key_prefix text,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.crm_sms_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  dlt_template_id text NOT NULL CHECK (dlt_template_id ~ '^[0-9]{10,25}$'),
  category text NOT NULL DEFAULT 'service' CHECK (category IN ('transactional', 'service', 'promotional')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sms_templates_name_uidx ON tenant.crm_sms_templates (organization_id, lower(name));
CREATE TABLE IF NOT EXISTS tenant.crm_sms_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact')),
  entity_id uuid NOT NULL,
  phone text NOT NULL,
  template_id uuid REFERENCES tenant.crm_sms_templates(id),
  body text NOT NULL,
  provider text NOT NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed')),
  error_message text,
  activity_id uuid,
  sent_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_at timestamptz
);
CREATE INDEX IF NOT EXISTS crm_sms_messages_record_idx ON tenant.crm_sms_messages (organization_id, entity_type, entity_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sms_messages_provider_uidx ON tenant.crm_sms_messages (organization_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_telephony_settings', 'crm_call_agents', 'crm_calls', 'crm_sms_settings', 'crm_sms_templates', 'crm_sms_messages'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_telephony_settings, tenant.crm_calls, tenant.crm_sms_settings, tenant.crm_sms_templates, tenant.crm_sms_messages TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_call_agents TO vercent_app, vercent_worker;

-- The callbacks' keys resolve their organization before any organization context exists.
CREATE OR REPLACE FUNCTION tenant.crm_resolve_channel_webhook(key_hash text)
RETURNS TABLE(organization_id uuid, channel text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT settings.organization_id, 'call'::text FROM tenant.crm_telephony_settings settings WHERE settings.webhook_key_hash = key_hash
  UNION ALL
  SELECT settings.organization_id, 'sms'::text FROM tenant.crm_sms_settings settings WHERE settings.webhook_key_hash = key_hash
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_resolve_channel_webhook(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_resolve_channel_webhook(text) TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0175_crm_calls_sms.sql', 'crm-calls-sms') ON CONFLICT DO NOTHING;
