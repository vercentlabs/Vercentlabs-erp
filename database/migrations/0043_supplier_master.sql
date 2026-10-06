-- Supplier Master.
--
-- One supplier identity per party. The organization itself is the shared
-- tenant.business_parties row (the same row a Customer, a CRM account and
-- Accounts Payable use: its name, legal name, GSTIN, PAN, website and
-- country). The supplier ROLE is tenant.procurement_suppliers, one row per
-- party: the supplier number, type, category, status and the procurement
-- commercial defaults (currency, payment terms, buyer). A company that is
-- both a customer and a supplier keeps one party with two independent roles;
-- its customer payment terms never become its supplier payment terms.
--
-- Every procurement document already points at procurement_suppliers.id, and
-- every vendor bill and payment at the party, so both reach the same supplier.
--
-- The generic document engine stored suppliers as a JSON blob; that use ends
-- here. Its columns (data, content_hash, search_text, version) stay on the
-- table, unused by suppliers, because a migration never drops anything.

-- ============================================================ 1. the supplier role

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant.procurement_suppliers) THEN
    RAISE EXCEPTION 'tenant.procurement_suppliers has rows from the retired generic supplier form. Move them to the Supplier Master (party, number) before applying 0043.';
  END IF;
END $$;

ALTER TABLE tenant.procurement_suppliers
  ADD COLUMN IF NOT EXISTS supplier_number text,
  ADD COLUMN IF NOT EXISTS party_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_type text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS default_currency character(3),
  ADD COLUMN IF NOT EXISTS payment_term_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_buyer_id uuid,
  ADD COLUMN IF NOT EXISTS primary_email text,
  ADD COLUMN IF NOT EXISTS primary_phone text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE tenant.procurement_suppliers
  ADD COLUMN IF NOT EXISTS normalized_email text GENERATED ALWAYS AS (tenant.crm_normalize_email(primary_email)) STORED,
  ADD COLUMN IF NOT EXISTS normalized_phone text GENERATED ALWAYS AS (tenant.crm_normalize_phone(primary_phone)) STORED;

ALTER TABLE tenant.procurement_suppliers ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE tenant.procurement_suppliers ALTER COLUMN supplier_number SET NOT NULL;
ALTER TABLE tenant.procurement_suppliers ALTER COLUMN party_id SET NOT NULL;
ALTER TABLE tenant.procurement_suppliers ALTER COLUMN supplier_type SET NOT NULL;
ALTER TABLE tenant.procurement_suppliers ALTER COLUMN category SET NOT NULL;
ALTER TABLE tenant.procurement_suppliers ALTER COLUMN default_currency SET NOT NULL;
ALTER TABLE tenant.procurement_suppliers ALTER COLUMN payment_term_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_suppliers_master_status_check') THEN
    ALTER TABLE tenant.procurement_suppliers
      ADD CONSTRAINT procurement_suppliers_master_status_check CHECK (status IN ('active', 'inactive', 'blocked')),
      ADD CONSTRAINT procurement_suppliers_type_check CHECK (supplier_type IN ('business', 'individual')),
      ADD CONSTRAINT procurement_suppliers_category_check
        CHECK (category IN ('raw_materials', 'finished_goods', 'services', 'contractor', 'logistics', 'maintenance', 'utilities', 'other')),
      ADD CONSTRAINT procurement_suppliers_currency_check CHECK (default_currency ~ '^[A-Z]{3}$'),
      -- A blocked supplier always says why, who and when.
      ADD CONSTRAINT procurement_suppliers_block_check
        CHECK ((status = 'blocked') = (blocked_at IS NOT NULL) AND (status <> 'blocked' OR (length(btrim(COALESCE(blocked_reason, ''))) >= 3 AND blocked_by IS NOT NULL))),
      ADD CONSTRAINT procurement_suppliers_party_fk FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties (organization_id, id),
      ADD CONSTRAINT procurement_suppliers_payment_term_fk FOREIGN KEY (organization_id, payment_term_id) REFERENCES tenant.payment_terms (organization_id, id),
      ADD CONSTRAINT procurement_suppliers_buyer_fk FOREIGN KEY (assigned_buyer_id) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_suppliers_number_uidx ON tenant.procurement_suppliers (organization_id, supplier_number);
-- One supplier role per organization identity.
CREATE UNIQUE INDEX IF NOT EXISTS procurement_suppliers_party_uidx ON tenant.procurement_suppliers (organization_id, party_id);
CREATE INDEX IF NOT EXISTS procurement_suppliers_list_idx ON tenant.procurement_suppliers (organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS procurement_suppliers_buyer_idx ON tenant.procurement_suppliers (organization_id, assigned_buyer_id) WHERE assigned_buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS procurement_suppliers_email_idx ON tenant.procurement_suppliers (organization_id, normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS procurement_suppliers_phone_idx ON tenant.procurement_suppliers (organization_id, normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_parties_gstin_idx ON tenant.business_parties (organization_id, upper(gstin)) WHERE gstin IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_parties_pan_idx ON tenant.business_parties (organization_id, normalized_pan) WHERE normalized_pan IS NOT NULL;

-- ============================================================ 2. locations

-- Where the supplier is: registered office, billing office, ordering office,
-- the place goods ship from, branches. A location may carry its own GST
-- registration, so a supplier is never limited to one GSTIN. Documents keep
-- a snapshot of the location they used.
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  address_type text NOT NULL CHECK (address_type IN ('registered', 'billing', 'ordering', 'dispatch', 'branch', 'other')),
  label text,
  line1 text NOT NULL CHECK (btrim(line1) <> ''),
  line2 text,
  city text NOT NULL CHECK (btrim(city) <> ''),
  district text,
  state text,
  state_code text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  postal_code text,
  country_code character(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  gst_registration_type text CHECK (gst_registration_type IS NULL OR gst_registration_type IN
    ('registered_regular', 'registered_composition', 'sez', 'deemed_export', 'unregistered', 'consumer', 'overseas')),
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers (organization_id, id),
  CHECK (status = 'active' OR NOT is_primary)
);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_addresses_primary_uidx ON tenant.procurement_supplier_addresses (organization_id, supplier_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS procurement_supplier_addresses_supplier_idx ON tenant.procurement_supplier_addresses (organization_id, supplier_id, status);
CREATE INDEX IF NOT EXISTS procurement_supplier_addresses_gstin_idx ON tenant.procurement_supplier_addresses (organization_id, gstin) WHERE gstin IS NOT NULL;
ALTER TABLE tenant.procurement_supplier_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_addresses
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.procurement_supplier_addresses TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_addresses TO vercent_worker;

-- ============================================================ 3. contacts

-- The people at a supplier are shared Contact records (tenant.contacts, on the
-- supplier's party); this is only the relationship and its role.
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'other' CHECK (role IN ('sales', 'quotation', 'procurement', 'accounts', 'dispatch', 'technical', 'management', 'other')),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, supplier_id, contact_id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers (organization_id, id),
  FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts (organization_id, id),
  CHECK (status = 'active' OR NOT is_primary)
);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_contacts_primary_uidx ON tenant.procurement_supplier_contacts (organization_id, supplier_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS procurement_supplier_contacts_contact_idx ON tenant.procurement_supplier_contacts (organization_id, contact_id);
ALTER TABLE tenant.procurement_supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_contacts
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.procurement_supplier_contacts TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_contacts TO vercent_worker;

-- ============================================================ 4. history

-- The business events of a supplier, never every keystroke: created, name,
-- legal name, GSTIN, currency, payment terms, buyer, primary contact, an
-- address, blocked, unblocked, deactivated, payment details changed.
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers (organization_id, id)
);
CREATE INDEX IF NOT EXISTS procurement_supplier_events_supplier_idx ON tenant.procurement_supplier_events (organization_id, supplier_id, occurred_at DESC);
ALTER TABLE tenant.procurement_supplier_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_events FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_events
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
-- DELETE only for a supplier created by mistake and never used (deleteSupplier).
GRANT SELECT, INSERT, DELETE ON tenant.procurement_supplier_events TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_events TO vercent_worker;

-- ============================================================ 5. payment details (Finance)

-- Where a supplier is paid. Finance owns it: only Finance permissions read the
-- full account number or change it, and every change is recorded in the
-- supplier's history with the number masked. Nothing in procurement needs it.
CREATE TABLE IF NOT EXISTS tenant.accounting_supplier_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  account_holder text NOT NULL CHECK (btrim(account_holder) <> ''),
  bank_name text NOT NULL CHECK (btrim(bank_name) <> ''),
  account_number text NOT NULL CHECK (account_number ~ '^[A-Z0-9]{4,34}$'),
  ifsc_code text CHECK (ifsc_code IS NULL OR ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  swift_code text CHECK (swift_code IS NULL OR swift_code ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  currency_code character(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers (organization_id, id),
  CHECK (status = 'active' OR NOT is_primary)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_supplier_bank_accounts_primary_uidx ON tenant.accounting_supplier_bank_accounts (organization_id, supplier_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS accounting_supplier_bank_accounts_supplier_idx ON tenant.accounting_supplier_bank_accounts (organization_id, supplier_id, status);
ALTER TABLE tenant.accounting_supplier_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_supplier_bank_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.accounting_supplier_bank_accounts
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_supplier_bank_accounts TO vercent_app;
GRANT SELECT ON tenant.accounting_supplier_bank_accounts TO vercent_worker;

-- ============================================================ 6. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.suppliers.view_all', 'View all suppliers', 'Procurement', 'See every supplier, not only the ones assigned to you as buyer.'),
  ('procurement.suppliers.create', 'Create suppliers', 'Procurement', 'Add a supplier, or give an existing customer or account the supplier role.'),
  ('procurement.suppliers.edit', 'Edit suppliers', 'Procurement', 'Change a supplier''s name, legal name, type, category, email, phone, website and notes.'),
  ('procurement.suppliers.status', 'Activate and deactivate suppliers', 'Procurement', 'Make a supplier inactive for new business, or active again.'),
  ('procurement.suppliers.block', 'Block and unblock suppliers', 'Procurement', 'Put a supplier on a procurement hold with a reason, or lift it.'),
  ('procurement.suppliers.addresses', 'Manage supplier addresses', 'Procurement', 'Add and change a supplier''s registered, billing, ordering, dispatch and branch addresses.'),
  ('procurement.suppliers.contacts', 'Manage supplier contacts', 'Procurement', 'Add people at a supplier, their roles, and the primary contact.'),
  ('procurement.suppliers.commercial', 'Manage supplier commercial defaults', 'Procurement', 'Change a supplier''s default currency, payment terms and buyer.'),
  ('procurement.suppliers.tax', 'Manage supplier tax information', 'Procurement', 'Change a supplier''s GST registration type, GSTIN, PAN and registered state.'),
  ('procurement.suppliers.import', 'Import suppliers', 'Procurement', 'Create suppliers from a CSV or Excel file.'),
  ('procurement.suppliers.export', 'Export suppliers', 'Procurement', 'Download the supplier list.'),
  ('procurement.suppliers.payables.view', 'View supplier payables summary', 'Procurement', 'See what is owed to a supplier, overdue and paid, from Accounts Payable.'),
  ('accounting.supplier_payment_details.view', 'View supplier payment details', 'Accounting', 'See the bank accounts suppliers are paid to, with full account numbers.'),
  ('accounting.supplier_payment_details.manage', 'Manage supplier payment details', 'Accounting', 'Add and change the bank accounts suppliers are paid to. Every change is recorded.')
ON CONFLICT (key) DO NOTHING;

-- Whoever saw suppliers sees all of them, as before.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.suppliers.view_all' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.suppliers.view'
ON CONFLICT DO NOTHING;
-- Whoever maintained suppliers creates and maintains them, their places, people, terms and tax data.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.suppliers.create', 'procurement.suppliers.edit', 'procurement.suppliers.addresses',
    'procurement.suppliers.contacts', 'procurement.suppliers.commercial', 'procurement.suppliers.tax', 'procurement.suppliers.import', 'procurement.suppliers.export'])
 WHERE existing.permission_key = 'procurement.suppliers.manage'
ON CONFLICT DO NOTHING;
-- Whoever qualified suppliers decides whether one may be used: active, inactive, blocked.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.suppliers.status', 'procurement.suppliers.block', 'procurement.suppliers.payables.view'])
 WHERE existing.permission_key = 'procurement.suppliers.qualify'
ON CONFLICT DO NOTHING;
-- Accounts Payable sees what suppliers are owed.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.suppliers.payables.view' FROM public.role_permissions existing
 WHERE existing.permission_key IN ('accounting.payables.manage', 'accounting.payables.approve')
ON CONFLICT DO NOTHING;
-- Payment details stay with Finance: whoever pays suppliers sees them; only whoever approves payments changes them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'accounting.supplier_payment_details.view' FROM public.role_permissions existing
 WHERE existing.permission_key IN ('accounting.payments.manage', 'accounting.payments.approve')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'accounting.supplier_payment_details.manage' FROM public.role_permissions existing
 WHERE existing.permission_key = 'accounting.payments.approve'
ON CONFLICT DO NOTHING;

-- Procurement chooses purchase payment terms, so it sees them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'payment_terms.view' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.view'
ON CONFLICT DO NOTHING;

-- Whoever can change a supplier and also where it is paid could redirect a payment: review it.
INSERT INTO public.access_conflict_rules (key, first_permission_key, second_permission_key, severity, description) VALUES
  ('supplier_edit_payment_details', 'procurement.suppliers.edit', 'accounting.supplier_payment_details.manage', 'warning',
   'Editing suppliers and changing the bank accounts they are paid to should be separated: together they allow a payment to be redirected.')
ON CONFLICT (key) DO NOTHING;

-- The generic supplier form's permissions are retired with it (their conflict rule goes with them).
DELETE FROM public.role_permissions WHERE permission_key IN ('procurement.suppliers.manage', 'procurement.suppliers.qualify', 'procurement.suppliers.sensitive');
DELETE FROM public.permissions WHERE key IN ('procurement.suppliers.manage', 'procurement.suppliers.qualify', 'procurement.suppliers.sensitive');

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0043_supplier_master.sql', 'supplier-master');
