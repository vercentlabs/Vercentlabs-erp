-- CRM audit (Vercentlabs CRM — Full Audit Report, 21 Oct 2026). Additive and re-runnable.
--
-- 1. Working week per organization (M3, B4): the days and hours the business works, and which Saturdays of the month are off
--    (many Indian businesses close on the 2nd and 4th). Reminders skip days off (with the holidays), and the lead first-response
--    time and the stage time limits count working hours and days. New and existing organizations start Monday–Saturday, 10:00–19:00.

ALTER TABLE tenant.crm_settings
  ADD COLUMN IF NOT EXISTS working_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  ADD COLUMN IF NOT EXISTS work_start text NOT NULL DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS work_end text NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS saturdays_off smallint[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_settings_working_week_check') THEN
    ALTER TABLE tenant.crm_settings ADD CONSTRAINT crm_settings_working_week_check CHECK (
      cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ '{0,1,2,3,4,5,6}'::smallint[]
      AND work_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND work_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND work_start < work_end
      AND saturdays_off <@ '{1,2,3,4,5}'::smallint[]);
  END IF;
END $$;

-- 2. CRM quotes (M1): a quotation or proforma sent straight from a deal when the organization has no Sales app — items, GST (CGST+SGST
--    within the state, IGST across states), a PDF, email or a WhatsApp link to the customer's own page. Switching Sales on later turns a
--    quote into a Sales quotation (sales_quotation_id); the quote stays as history.
CREATE TABLE IF NOT EXISTS tenant.crm_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  quote_number text NOT NULL,
  kind text NOT NULL DEFAULT 'quotation' CHECK (kind IN ('quotation', 'proforma')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'upgraded')),
  quote_date date NOT NULL DEFAULT current_date,
  valid_until date,
  currency_code text NOT NULL DEFAULT 'INR',
  seller_state_code text,
  place_of_supply text,
  customer_gstin text,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  terms text CHECK (terms IS NULL OR char_length(terms) <= 4000),
  subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  discount_total numeric(18, 2) NOT NULL DEFAULT 0,
  tax_total numeric(18, 2) NOT NULL DEFAULT 0,
  grand_total numeric(18, 2) NOT NULL DEFAULT 0,
  share_token_hash text UNIQUE,
  share_token_encrypted jsonb,
  sent_at timestamptz,
  decided_at timestamptz,
  sales_quotation_id uuid REFERENCES tenant.sales_quotations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quote_number)
);
ALTER TABLE tenant.crm_quotes ADD COLUMN IF NOT EXISTS share_token_encrypted jsonb;
CREATE INDEX IF NOT EXISTS crm_quotes_deal_idx ON tenant.crm_quotes (organization_id, opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES tenant.crm_quotes(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid REFERENCES tenant.items(id) ON DELETE SET NULL,
  description text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 1000),
  hsn_sac text CHECK (hsn_sac IS NULL OR char_length(hsn_sac) <= 12),
  quantity numeric(18, 3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18, 2) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  gst_rate numeric(5, 2) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 100),
  taxable numeric(18, 2) NOT NULL,
  cgst numeric(18, 2) NOT NULL DEFAULT 0,
  sgst numeric(18, 2) NOT NULL DEFAULT 0,
  igst numeric(18, 2) NOT NULL DEFAULT 0,
  line_total numeric(18, 2) NOT NULL,
  UNIQUE (quote_id, line_number)
);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_quotes', 'crm_quote_lines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

-- The customer's link to a quote carries only a token: this finds its organization before any organization is set.
CREATE OR REPLACE FUNCTION tenant.crm_resolve_quote_token(token_hash_in text)
RETURNS TABLE(organization_id uuid, quote_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT quote.organization_id, quote.id FROM tenant.crm_quotes quote WHERE quote.share_token_hash = token_hash_in LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_resolve_quote_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_resolve_quote_token(text) TO vercent_app, vercent_worker;

-- 3. Custom fields on companies and contacts (M4): an FMCG distributor's outlet class, channel (GT/MT), beat and distributor on the company;
--    a real-estate buyer's budget on the contact. Their values live in custom_data, keyed by the field's key, as on leads and deals.
ALTER TABLE tenant.business_parties ADD COLUMN IF NOT EXISTS custom_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant.contacts ADD COLUMN IF NOT EXISTS custom_data jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS business_parties_custom_data_idx ON tenant.business_parties USING gin (custom_data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS contacts_custom_data_idx ON tenant.contacts USING gin (custom_data jsonb_path_ops);
ALTER TABLE tenant.crm_custom_fields DROP CONSTRAINT IF EXISTS crm_custom_fields_entity_type_check;
ALTER TABLE tenant.crm_custom_fields ADD CONSTRAINT crm_custom_fields_entity_type_check CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact'));

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0217_crm_audit.sql', 'crm-audit') ON CONFLICT DO NOTHING;
