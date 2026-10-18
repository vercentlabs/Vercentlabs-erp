-- CRM plan, step 5.7: the switch to work without leads. Off, enquiries that arrive on their own (web forms, lead connectors, email,
-- WhatsApp) become a company, contact and deal straight away, and Leads leaves the menu. On by default.
ALTER TABLE tenant.crm_settings ADD COLUMN IF NOT EXISTS leads_enabled boolean NOT NULL DEFAULT true;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0183_crm_leads_switch.sql', 'crm-leads-switch') ON CONFLICT DO NOTHING;
