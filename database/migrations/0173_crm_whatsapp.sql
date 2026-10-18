-- CRM plan, step 4.2: WhatsApp from CRM.
--
-- 1. Click-to-chat (any organization): WhatsApp opens on the salesperson's own phone or WhatsApp Web with the message ready, and CRM
--    logs it on the record.
-- 2. The WhatsApp Business (Cloud) API, when the organization connects its number: messages go from CRM itself; the customer's replies
--    and the delivery and read receipts come back to the connector's webhook and land on the lead or contact with that number (or open a
--    lead from WhatsApp). WhatsApp's rules are kept: outside 24 hours from the customer's last message only an approved template may be
--    sent, and only to someone who agreed to WhatsApp messages.
CREATE TABLE IF NOT EXISTS tenant.crm_whatsapp_settings (
  organization_id uuid PRIMARY KEY,
  mode text NOT NULL DEFAULT 'click_to_chat' CHECK (mode IN ('click_to_chat', 'cloud_api')),
  display_number text,
  phone_number_id text,
  encrypted_credentials jsonb,
  webhook_key_hash character(64) UNIQUE,
  webhook_key_prefix text,
  last_received_at timestamptz,
  last_error text,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_whatsapp_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact')),
  entity_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel text NOT NULL CHECK (channel IN ('click_to_chat', 'cloud_api')),
  phone text NOT NULL,
  body text,
  template_name text,
  template_language text,
  wa_message_id text,
  status text NOT NULL CHECK (status IN ('logged', 'sent', 'delivered', 'read', 'failed', 'received')),
  error_message text,
  activity_id uuid,
  sent_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_whatsapp_messages_wa_uidx ON tenant.crm_whatsapp_messages (organization_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_whatsapp_messages_phone_idx ON tenant.crm_whatsapp_messages (organization_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_whatsapp_messages_record_idx ON tenant.crm_whatsapp_messages (organization_id, entity_type, entity_id, created_at DESC);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_whatsapp_settings', 'crm_whatsapp_messages'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_whatsapp_settings, tenant.crm_whatsapp_messages TO vercent_app, vercent_worker;

-- The webhook's key resolves its organization before any organization context exists.
CREATE OR REPLACE FUNCTION tenant.crm_resolve_whatsapp_webhook(key_hash text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT settings.organization_id FROM tenant.crm_whatsapp_settings settings WHERE settings.webhook_key_hash = key_hash LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_resolve_whatsapp_webhook(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_resolve_whatsapp_webhook(text) TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0173_crm_whatsapp.sql', 'crm-whatsapp') ON CONFLICT DO NOTHING;
