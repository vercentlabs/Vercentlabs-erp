-- Customer Addresses and Contacts (Sales).
--
-- 1. Address: the person to ask for at the location, with a phone and email.
-- 2. Customer contact relationship: the location the person works at, a
--    procurement flag and notes about the relationship.
-- 3. Permissions for viewing addresses and contacts, deactivating them,
--    changing defaults, the primary contact and a location's GSTIN, granted
--    to the roles that hold the matching Customer Master permission today.

-- ============================================================ 1. address

ALTER TABLE tenant.addresses
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text;

-- ============================================================ 2. customer contact

ALTER TABLE tenant.crm_contact_account_relationships
  ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_procurement_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS crm_contact_account_relationships_address_idx
  ON tenant.crm_contact_account_relationships (organization_id, address_id) WHERE address_id IS NOT NULL;

-- ============================================================ 3. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.customers.addresses.view', 'View customer addresses', 'Sales', 'See the addresses of customers the user can open.'),
  ('sales.customers.addresses.inactivate', 'Inactivate customer addresses', 'Sales', 'Deactivate and reactivate a customer address.'),
  ('sales.customers.addresses.set_default_billing', 'Set default billing address', 'Sales', 'Choose which address is a customer''s default billing address.'),
  ('sales.customers.addresses.set_default_shipping', 'Set default shipping address', 'Sales', 'Choose which address is a customer''s default shipping address.'),
  ('sales.customers.addresses.edit_gstin', 'Edit address GSTIN', 'Sales', 'Change the GSTIN and tax state of a customer location.'),
  ('sales.customers.contacts.view', 'View customer contacts', 'Sales', 'See the contacts of customers the user can open.'),
  ('sales.customers.contacts.inactivate', 'Inactivate customer contacts', 'Sales', 'End or restore a person''s relationship with a customer.'),
  ('sales.customers.contacts.set_primary', 'Set primary customer contact', 'Sales', 'Choose a customer''s primary contact.')
ON CONFLICT (key) DO NOTHING;

-- Whoever can open customers sees their addresses and contacts.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.customers.addresses.view', 'sales.customers.contacts.view'])
 WHERE existing.permission_key = 'sales.customers.view'
ON CONFLICT DO NOTHING;

-- Whoever manages addresses may deactivate them and move the defaults.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'sales.customers.addresses.inactivate', 'sales.customers.addresses.set_default_billing', 'sales.customers.addresses.set_default_shipping'])
 WHERE existing.permission_key = 'sales.customers.manage_addresses'
ON CONFLICT DO NOTHING;

-- Whoever manages contacts may end a relationship and choose the primary contact.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.customers.contacts.inactivate', 'sales.customers.contacts.set_primary'])
 WHERE existing.permission_key = 'sales.customers.manage_contacts'
ON CONFLICT DO NOTHING;

-- A location's GSTIN is as sensitive as the customer's own.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.customers.addresses.edit_gstin'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.customers.edit_gstin'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0023_sales_customer_addresses_contacts.sql', 'sales-customer-addresses-contacts');
