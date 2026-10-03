-- CRM Accounts / Companies: every database object the Accounts feature owns.
--
-- An account is a row of tenant.business_parties: the one record of an
-- organization that CRM, Sales, Finance, Projects and Support all reference.
-- Identity (names, phones, email, website, addresses, contacts) lives there
-- once, so CRM and Sales can never drift apart. This file adds the CRM
-- properties of an account and the Customer Master designation; commercial
-- settings (payment terms, credit, tax identity, currency) stay with Sales.
--
--   1. Normalization functions used by duplicate detection
--   2. Account fields on business_parties
--   3. Address defaults
--   4. Contact fields shown on the account
--   5. Related contact on activities
--   6. Account tags
--   7. Account history (timeline / audit)
--   8. Row-level security and grants
--   9. Permissions
--
-- Run once, after the earlier files in this folder.
BEGIN;

-- ============================================================ 1. normalization

-- "ABC Pvt. Ltd.", "ABC Private Limited" and "The ABC Co." all normalize to
-- "abc", so they are compared as the same company name.
CREATE FUNCTION tenant.crm_normalize_company_name(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(COALESCE(value, '')), '[^a-z0-9]+', ' ', 'g'),
             '\m(the|pvt|private|ltd|limited|llp|llc|inc|incorporated|co|company|corp|corporation|plc|opc)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- "https://www.acme.example/about" -> "acme.example"
CREATE FUNCTION tenant.crm_web_domain(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT NULLIF(regexp_replace(lower(btrim(COALESCE(value, ''))), '^([a-z]+://)?(www\.)?([^/:?#]+).*$', '\3'), '')
$$;

-- "sales@acme.example" -> "acme.example"
CREATE FUNCTION tenant.crm_email_domain(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT NULLIF(split_part(lower(btrim(COALESCE(value, ''))), '@', 2), '')
$$;

-- ============================================================ 2. account fields

ALTER TABLE tenant.business_parties
  -- relationship type (CRM); party_type stays the commercial role Sales and Finance use
  ADD COLUMN account_type text DEFAULT 'prospect' NOT NULL,
  ADD COLUMN secondary_phone text,
  ADD COLUMN employee_range text,
  ADD COLUMN annual_revenue numeric(18,2),
  ADD COLUMN description text,
  ADD COLUMN team_id uuid,
  ADD COLUMN source_id uuid,
  ADD COLUMN source_detail text,
  ADD COLUMN assigned_at timestamp with time zone,
  ADD COLUMN last_activity_at timestamp with time zone,
  ADD COLUMN archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Customer Master: set when the account becomes usable by Sales and Finance
  ADD COLUMN customer_number text,
  ADD COLUMN customer_since timestamp with time zone,
  ADD COLUMN customer_created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- duplicate detection
  ADD COLUMN normalized_company_name text GENERATED ALWAYS AS (tenant.crm_normalize_company_name(display_name)) STORED,
  ADD COLUMN normalized_legal_company_name text GENERATED ALWAYS AS (tenant.crm_normalize_company_name(legal_name)) STORED,
  ADD COLUMN website_domain text GENERATED ALWAYS AS (tenant.crm_web_domain(website)) STORED,
  ADD COLUMN email_domain text GENERATED ALWAYS AS (tenant.crm_email_domain(email)) STORED,
  ADD CONSTRAINT business_parties_account_type_check CHECK (account_type = ANY (ARRAY['prospect', 'customer', 'partner', 'other'])),
  ADD CONSTRAINT business_parties_employee_range_check CHECK (employee_range IS NULL OR employee_range = ANY (ARRAY['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+'])),
  ADD CONSTRAINT business_parties_annual_revenue_check CHECK (annual_revenue IS NULL OR annual_revenue >= 0),
  ADD CONSTRAINT business_parties_display_name_present_check CHECK (btrim(display_name) <> ''),
  -- an archived account is always inactive for transactions
  ADD CONSTRAINT business_parties_archive_check CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT business_parties_customer_check CHECK ((customer_number IS NULL) = (customer_since IS NULL)),
  ADD CONSTRAINT business_parties_team_id_organization_fkey FOREIGN KEY (organization_id, team_id) REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (team_id),
  ADD CONSTRAINT business_parties_source_id_organization_fkey FOREIGN KEY (organization_id, source_id) REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id);

-- one Customer Master per account, one customer number per organization
CREATE UNIQUE INDEX business_parties_customer_number_uidx ON tenant.business_parties (organization_id, customer_number) WHERE customer_number IS NOT NULL;
-- the working lists
CREATE INDEX business_parties_account_list_idx ON tenant.business_parties (organization_id, status, updated_at DESC, id DESC) WHERE party_type <> 'supplier';
CREATE INDEX business_parties_account_owner_idx ON tenant.business_parties (organization_id, owner_user_id, status);
CREATE INDEX business_parties_account_team_idx ON tenant.business_parties (organization_id, team_id) WHERE team_id IS NOT NULL;
-- duplicate detection
CREATE INDEX business_parties_duplicate_name_idx ON tenant.business_parties (organization_id, normalized_company_name);
CREATE INDEX business_parties_duplicate_name_trgm_idx ON tenant.business_parties USING gin (normalized_company_name public.gin_trgm_ops);
CREATE INDEX business_parties_duplicate_domain_idx ON tenant.business_parties (organization_id, website_domain) WHERE website_domain IS NOT NULL;
-- search
CREATE INDEX business_parties_account_search_idx ON tenant.business_parties USING gin (
  lower(COALESCE(code, '') || ' ' || COALESCE(display_name, '') || ' ' || COALESCE(legal_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(phone, '') || ' '
    || COALESCE(secondary_phone, '') || ' ' || COALESCE(website, '') || ' ' || COALESCE(customer_number, '') || ' ' || COALESCE(gstin, '')) public.gin_trgm_ops);

-- A party Sales or Finance treats as a customer is a customer account in CRM,
-- whichever module made it one.
CREATE FUNCTION tenant.crm_account_type_follows_party_type() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.party_type IN ('customer', 'both') THEN
    NEW.account_type := 'customer';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER business_parties_account_type_follows_party_type BEFORE INSERT OR UPDATE OF party_type, account_type ON tenant.business_parties
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_account_type_follows_party_type();

-- ============================================================ 3. address defaults
-- An account has any number of addresses; at most one is the default billing
-- address and one the default shipping address.

ALTER TABLE tenant.addresses
  ADD COLUMN is_default_billing boolean DEFAULT false NOT NULL,
  ADD COLUMN is_default_shipping boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX addresses_default_billing_uidx ON tenant.addresses (organization_id, party_id) WHERE is_default_billing AND status = 'active';
CREATE UNIQUE INDEX addresses_default_shipping_uidx ON tenant.addresses (organization_id, party_id) WHERE is_default_shipping AND status = 'active';

-- ============================================================ 4. contact fields shown on the account

ALTER TABLE tenant.contacts
  ADD COLUMN department text,
  ADD COLUMN is_decision_maker boolean DEFAULT false NOT NULL;

-- ============================================================ 5. related contact on activities
-- A call, meeting or task logged on an account can name the contact involved.

ALTER TABLE tenant.crm_activities
  ADD COLUMN related_contact_id uuid,
  ADD CONSTRAINT crm_activities_related_contact_organization_fkey FOREIGN KEY (organization_id, related_contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (related_contact_id);

-- ============================================================ 6. account tags

CREATE TABLE tenant.crm_account_tags (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_account_tags_pkey PRIMARY KEY (organization_id, party_id, tag_id),
  CONSTRAINT crm_account_tags_party_organization_fkey FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_account_tags_tag_organization_fkey FOREIGN KEY (organization_id, tag_id) REFERENCES tenant.crm_tags(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_account_tags_tag_idx ON tenant.crm_account_tags (organization_id, tag_id);

-- ============================================================ 7. account history
-- One append-only row per significant event, with old and new values for
-- field changes. It is both the account timeline's event source and its
-- audit trail; the application roles can only read and add rows.

CREATE TABLE tenant.crm_account_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_account_history_event_type_check CHECK (event_type = ANY (ARRAY[
    'created', 'updated', 'owner_changed', 'team_changed', 'type_changed', 'status_changed', 'parent_changed',
    'address_added', 'address_updated', 'address_removed', 'contact_linked', 'contact_unlinked', 'primary_contact_changed',
    'lead_converted', 'opportunity_created', 'customer_created', 'customer_linked', 'merged', 'deactivated', 'reactivated', 'archived'])),
  CONSTRAINT crm_account_history_party_organization_fkey FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_account_history_party_idx ON tenant.crm_account_history (organization_id, party_id, created_at DESC);

-- ============================================================ 8. row-level security and grants

ALTER TABLE tenant.crm_account_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_account_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_account_tags USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

ALTER TABLE tenant.crm_account_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_account_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_account_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant.crm_account_tags TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON TABLE tenant.crm_account_history TO vercent_app, vercent_worker;
GRANT EXECUTE ON FUNCTION tenant.crm_normalize_company_name(text), tenant.crm_web_domain(text), tenant.crm_email_domain(text) TO vercent_app, vercent_worker;

-- ============================================================ 9. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.accounts.view', 'View accounts', 'CRM', 'Open the account list and the accounts the user is allowed to see.'),
  ('crm.accounts.view_all', 'View all accounts', 'CRM', 'See every account in the organization regardless of owner.'),
  ('crm.accounts.view_sensitive', 'View account contact details', 'CRM', 'See account email addresses and phone numbers.'),
  ('crm.accounts.create', 'Create accounts', 'CRM', 'Add new accounts.'),
  ('crm.accounts.edit', 'Edit accounts', 'CRM', 'Change account details, addresses, linked contacts, tags, notes and activities.'),
  ('crm.accounts.archive', 'Archive accounts', 'CRM', 'Deactivate, reactivate and archive accounts.'),
  ('crm.accounts.delete', 'Delete unused accounts', 'CRM', 'Permanently delete an account that nothing refers to.'),
  ('crm.accounts.assign', 'Assign accounts', 'CRM', 'Give an unowned account an owner or a team.'),
  ('crm.accounts.reassign', 'Reassign accounts', 'CRM', 'Move an account that already has an owner to someone else.'),
  ('crm.accounts.merge', 'Merge accounts', 'CRM', 'Merge a duplicate account into another account.'),
  ('crm.accounts.import', 'Import accounts', 'CRM', 'Import accounts from a CSV or XLSX file.'),
  ('crm.accounts.export', 'Export accounts', 'CRM', 'Download the account list as a file.'),
  ('crm.accounts.create_customer', 'Create customer from account', 'CRM', 'Make an account a Customer Master that Sales and Finance can transact with.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0006_crm_accounts.sql', 'crm-accounts');

COMMIT;
