-- Customer Master (Sales).
--
-- A customer is the same business party as its CRM account; this migration
-- adds what the Customer Master needs on top of that shared record:
--
-- 1. Customer fields: business / individual, country, GST state and place of supply,
--    internal notes, and who blocked or changed the status, when and why.
-- 2. Address label ("Head Office", "Pune Warehouse").
-- 3. Billing and delivery contact flags on the contact relationship, one of
--    each per customer.
-- 4. Permissions for the Customer Master, granted to the roles that work
--    with customers today.

-- ============================================================ 1. customer fields

ALTER TABLE tenant.business_parties
  ADD COLUMN IF NOT EXISTS customer_kind text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS gst_state_code text,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS sales_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_blocked_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES public.users(id);

ALTER TABLE tenant.business_parties
  ADD CONSTRAINT business_parties_customer_kind_check CHECK (customer_kind IS NULL OR customer_kind IN ('business', 'individual')),
  ADD CONSTRAINT business_parties_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT business_parties_gst_state_code_check CHECK (gst_state_code IS NULL OR gst_state_code ~ '^[0-9]{2}$'),
  ADD CONSTRAINT business_parties_place_of_supply_check CHECK (place_of_supply IS NULL OR place_of_supply ~ '^[0-9]{2}$');

UPDATE tenant.business_parties
   SET customer_kind = 'business'
 WHERE customer_kind IS NULL AND (customer_number IS NOT NULL OR party_type IN ('customer', 'both'));

UPDATE tenant.business_parties
   SET gst_state_code = substr(gstin, 1, 2)
 WHERE gst_state_code IS NULL AND gstin ~ '^[0-9]{2}';

CREATE INDEX IF NOT EXISTS business_parties_customer_list_idx
  ON tenant.business_parties (organization_id, customer_since DESC)
  WHERE customer_number IS NOT NULL;

-- ============================================================ 2. address label

ALTER TABLE tenant.addresses ADD COLUMN IF NOT EXISTS label text;

-- ============================================================ 3. contact flags

ALTER TABLE tenant.crm_contact_account_relationships
  ADD COLUMN IF NOT EXISTS is_billing_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_shipping_contact boolean NOT NULL DEFAULT false;

ALTER TABLE tenant.crm_contact_account_relationships
  ADD CONSTRAINT crm_contact_account_relationships_flags_active_check
  CHECK (status = 'active' OR (NOT is_billing_contact AND NOT is_shipping_contact));

CREATE UNIQUE INDEX IF NOT EXISTS crm_contact_account_relationships_billing_contact_uidx
  ON tenant.crm_contact_account_relationships (organization_id, party_id) WHERE is_billing_contact;
CREATE UNIQUE INDEX IF NOT EXISTS crm_contact_account_relationships_shipping_contact_uidx
  ON tenant.crm_contact_account_relationships (organization_id, party_id) WHERE is_shipping_contact;

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.customers.view', 'View customers', 'Sales', 'Open the Customer Master: customers the user owns, and unassigned ones.'),
  ('sales.customers.view_team', 'View team customers', 'Sales', 'See customers owned by the user''s sales team.'),
  ('sales.customers.view_all', 'View all customers', 'Sales', 'See every customer of the organization.'),
  ('sales.customers.create', 'Create customers', 'Sales', 'Create a customer, directly or from a CRM account.'),
  ('sales.customers.edit', 'Edit customers', 'Sales', 'Change a customer''s identity and contact details.'),
  ('sales.customers.inactivate', 'Inactivate customers', 'Sales', 'Mark a customer as inactive.'),
  ('sales.customers.reactivate', 'Reactivate customers', 'Sales', 'Make an inactive customer active again.'),
  ('sales.customers.block', 'Block customers', 'Sales', 'Stop new sales documents for a customer.'),
  ('sales.customers.unblock', 'Unblock customers', 'Sales', 'Allow sales documents for a blocked customer again.'),
  ('sales.customers.delete', 'Delete customers', 'Sales', 'Permanently delete a customer that has no transactions.'),
  ('sales.customers.import', 'Import customers', 'Sales', 'Import customers from a CSV or Excel file.'),
  ('sales.customers.export', 'Export customers', 'Sales', 'Export the customer list.'),
  ('sales.customers.manage_addresses', 'Manage customer addresses', 'Sales', 'Add, change and remove customer addresses and their defaults.'),
  ('sales.customers.manage_contacts', 'Manage customer contacts', 'Sales', 'Add, link and remove customer contacts and their roles.'),
  ('sales.customers.link_account', 'Link CRM account', 'Sales', 'Create a customer from a CRM account or link one to an existing customer.'),
  ('sales.customers.edit_gstin', 'Edit customer GST details', 'Sales', 'Change a customer''s GSTIN and GST registration type.'),
  ('sales.customers.change_currency', 'Change customer currency', 'Sales', 'Change a customer''s default currency.'),
  ('sales.customers.change_payment_terms', 'Change customer payment terms', 'Sales', 'Change a customer''s default payment terms.'),
  ('sales.customers.change_price_list', 'Change customer price list', 'Sales', 'Change a customer''s default price list.'),
  ('sales.customers.view_financials', 'View customer financials', 'Sales', 'See outstanding, overdue and payment figures on a customer.')
ON CONFLICT (key) DO NOTHING;

-- Everyone who can open Sales keeps seeing every customer, as before.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.customers.view', 'sales.customers.view_all'])
 WHERE existing.permission_key = 'sales.view'
ON CONFLICT DO NOTHING;

-- Whoever writes quotations maintains the customers they sell to.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'sales.customers.create', 'sales.customers.edit', 'sales.customers.manage_addresses', 'sales.customers.manage_contacts', 'sales.customers.link_account'])
 WHERE existing.permission_key = 'sales.quotation.create'
ON CONFLICT DO NOTHING;

-- Sales approvers and administrators control status, tax and commercial terms.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'sales.customers.view_team', 'sales.customers.create', 'sales.customers.edit', 'sales.customers.manage_addresses', 'sales.customers.manage_contacts',
    'sales.customers.link_account', 'sales.customers.inactivate', 'sales.customers.reactivate', 'sales.customers.block', 'sales.customers.unblock',
    'sales.customers.delete', 'sales.customers.import', 'sales.customers.export', 'sales.customers.edit_gstin', 'sales.customers.change_currency',
    'sales.customers.change_payment_terms', 'sales.customers.change_price_list', 'sales.customers.view_financials'])
 WHERE existing.permission_key IN ('sales.quotation.approve', 'sales.settings.manage')
ON CONFLICT DO NOTHING;

-- Finance users who can open Sales see the receivable figures.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.customers.view_financials'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'accounting.view'
   AND EXISTS (SELECT 1 FROM public.role_permissions sales WHERE sales.role_id = existing.role_id AND sales.permission_key = 'sales.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0022_sales_customer_master.sql', 'sales-customer-master');
