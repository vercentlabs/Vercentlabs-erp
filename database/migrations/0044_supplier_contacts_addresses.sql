-- Supplier Contacts and Addresses.
--
-- A supplier location serves several purposes at once (one Pune head office
-- can be the registered, ordering and billing address), so purposes are a
-- relationship, not one type per row. Each purpose has at most one default
-- location, and each contact purpose at most one default person: both live
-- in one row per supplier (procurement_supplier_defaults), so two defaults
-- for one purpose cannot exist.
--
-- GST registrations are records of their own: a location links to the
-- registration it trades under, one registration may cover several places
-- of business, and a supplier may hold several (one per state). A GSTIN
-- belongs to one supplier in the tenant.
--
-- A contact is a shared Contact person; the supplier relationship carries
-- several roles and, optionally, the location the person works at.
--
-- Replaced, never dropped: procurement_supplier_addresses.address_type and
-- .is_primary, .gstin, .gst_registration_type, and
-- procurement_supplier_contacts.role and .is_primary. Their values move to
-- the new structure below; address_type and role are kept in step with the
-- first purpose / role only because their NOT NULL checks cannot be removed.

-- ============================================================ 1. tax registrations

CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_tax_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  gstin text NOT NULL CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  registration_type text NOT NULL DEFAULT 'registered_regular'
    CHECK (registration_type IN ('registered_regular', 'registered_composition', 'sez', 'deemed_export')),
  state_code text NOT NULL CHECK (state_code ~ '^[0-9]{2}$'),
  -- The supplier's principal registration: the GSTIN on the supplier itself.
  is_principal boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers (organization_id, id),
  CHECK (state_code = left(gstin, 2))
);
-- One GSTIN is one legal registration: it belongs to one supplier in the tenant.
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_tax_registrations_gstin_uidx ON tenant.procurement_supplier_tax_registrations (organization_id, gstin);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_tax_registrations_principal_uidx ON tenant.procurement_supplier_tax_registrations (organization_id, supplier_id) WHERE is_principal;
ALTER TABLE tenant.procurement_supplier_tax_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_tax_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_tax_registrations
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.procurement_supplier_tax_registrations TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_tax_registrations TO vercent_worker;

-- ============================================================ 2. locations

ALTER TABLE tenant.procurement_supplier_addresses
  ADD COLUMN IF NOT EXISTS locality text,
  ADD COLUMN IF NOT EXISTS location_email text,
  ADD COLUMN IF NOT EXISTS location_phone text,
  ADD COLUMN IF NOT EXISTS tax_registration_id uuid,
  -- For "this place is already on file" warnings: the address reduced to letters and digits.
  ADD COLUMN IF NOT EXISTS normalized_address text GENERATED ALWAYS AS (
    lower(regexp_replace(COALESCE(line1, '') || ' ' || COALESCE(line2, '') || ' ' || COALESCE(city, '') || ' ' || COALESCE(postal_code, '') || ' ' || COALESCE(country_code::text, ''),
      '[^[:alnum:]]+', '', 'g'))) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_addresses_supplier_id_uidx ON tenant.procurement_supplier_addresses (organization_id, supplier_id, id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_supplier_addresses_registration_fk') THEN
    -- A location trades under one of its own supplier's registrations.
    ALTER TABLE tenant.procurement_supplier_addresses
      ADD CONSTRAINT procurement_supplier_addresses_registration_fk FOREIGN KEY (organization_id, supplier_id, tax_registration_id)
        REFERENCES tenant.procurement_supplier_tax_registrations (organization_id, supplier_id, id),
      ADD CONSTRAINT procurement_supplier_addresses_location_email_check CHECK (location_email IS NULL OR location_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS procurement_supplier_addresses_normalized_idx ON tenant.procurement_supplier_addresses (organization_id, supplier_id, normalized_address);

CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_address_purposes (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  address_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('registered', 'ordering', 'billing', 'ship_from', 'branch', 'return_to', 'other')),
  PRIMARY KEY (organization_id, address_id, purpose),
  FOREIGN KEY (organization_id, supplier_id, address_id) REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS procurement_supplier_address_purposes_supplier_idx ON tenant.procurement_supplier_address_purposes (organization_id, supplier_id, purpose);
ALTER TABLE tenant.procurement_supplier_address_purposes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_address_purposes FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_address_purposes
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.procurement_supplier_address_purposes TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_address_purposes TO vercent_worker;

-- ============================================================ 3. contacts

ALTER TABLE tenant.procurement_supplier_contacts ADD COLUMN IF NOT EXISTS supplier_address_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_contacts_supplier_id_uidx ON tenant.procurement_supplier_contacts (organization_id, supplier_id, id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_supplier_contacts_location_fk') THEN
    -- The location a person works at is one of the same supplier's locations; a context, not a restriction.
    ALTER TABLE tenant.procurement_supplier_contacts
      ADD CONSTRAINT procurement_supplier_contacts_location_fk FOREIGN KEY (organization_id, supplier_id, supplier_address_id)
        REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_contact_roles (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  supplier_contact_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('sales', 'procurement', 'accounts', 'dispatch', 'technical', 'management', 'other')),
  PRIMARY KEY (organization_id, supplier_contact_id, role),
  FOREIGN KEY (organization_id, supplier_id, supplier_contact_id) REFERENCES tenant.procurement_supplier_contacts (organization_id, supplier_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS procurement_supplier_contact_roles_supplier_idx ON tenant.procurement_supplier_contact_roles (organization_id, supplier_id, role);
ALTER TABLE tenant.procurement_supplier_contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_contact_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_contact_roles
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.procurement_supplier_contact_roles TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_contact_roles TO vercent_worker;

-- ============================================================ 4. defaults

-- One row per supplier: the default location for each purpose and the default person for each contact purpose.
-- Every reference is to one of the same supplier's own locations or contact relationships.
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_defaults (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  registered_address_id uuid,
  ordering_address_id uuid,
  billing_address_id uuid,
  ship_from_address_id uuid,
  return_to_address_id uuid,
  primary_contact_id uuid,
  rfq_contact_id uuid,
  ordering_contact_id uuid,
  accounts_contact_id uuid,
  dispatch_contact_id uuid,
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, supplier_id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id, registered_address_id) REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, ordering_address_id) REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, billing_address_id) REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, ship_from_address_id) REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, return_to_address_id) REFERENCES tenant.procurement_supplier_addresses (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, primary_contact_id) REFERENCES tenant.procurement_supplier_contacts (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, rfq_contact_id) REFERENCES tenant.procurement_supplier_contacts (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, ordering_contact_id) REFERENCES tenant.procurement_supplier_contacts (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, accounts_contact_id) REFERENCES tenant.procurement_supplier_contacts (organization_id, supplier_id, id),
  FOREIGN KEY (organization_id, supplier_id, dispatch_contact_id) REFERENCES tenant.procurement_supplier_contacts (organization_id, supplier_id, id)
);
ALTER TABLE tenant.procurement_supplier_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_defaults FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_supplier_defaults
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.procurement_supplier_defaults TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_defaults TO vercent_worker;

-- ============================================================ 5. existing data

-- Registrations: each supplier's own GSTIN (principal), then every GSTIN its locations carried.
INSERT INTO tenant.procurement_supplier_tax_registrations (organization_id, supplier_id, gstin, registration_type, state_code, is_principal)
SELECT supplier.organization_id, supplier.id, upper(party.gstin),
       CASE WHEN party.tax_treatment IN ('registered_regular', 'registered_composition', 'sez', 'deemed_export') THEN party.tax_treatment ELSE 'registered_regular' END,
       left(upper(party.gstin), 2), true
  FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
 WHERE party.gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'
ON CONFLICT DO NOTHING;
INSERT INTO tenant.procurement_supplier_tax_registrations (organization_id, supplier_id, gstin, registration_type, state_code)
SELECT DISTINCT ON (address.organization_id, address.gstin) address.organization_id, address.supplier_id, address.gstin,
       CASE WHEN address.gst_registration_type IN ('registered_regular', 'registered_composition', 'sez', 'deemed_export') THEN address.gst_registration_type ELSE 'registered_regular' END,
       left(address.gstin, 2)
  FROM tenant.procurement_supplier_addresses address WHERE address.gstin IS NOT NULL
 ORDER BY address.organization_id, address.gstin, address.created_at
ON CONFLICT DO NOTHING;
UPDATE tenant.procurement_supplier_addresses address SET tax_registration_id = registration.id
  FROM tenant.procurement_supplier_tax_registrations registration
 WHERE registration.organization_id = address.organization_id AND registration.supplier_id = address.supplier_id AND registration.gstin = address.gstin
   AND address.tax_registration_id IS NULL;

-- Purposes from the old single type.
INSERT INTO tenant.procurement_supplier_address_purposes (organization_id, supplier_id, address_id, purpose)
SELECT organization_id, supplier_id, id, CASE address_type WHEN 'dispatch' THEN 'ship_from' ELSE address_type END
  FROM tenant.procurement_supplier_addresses
ON CONFLICT DO NOTHING;

-- Roles from the old single role (quotation work is part of sales).
INSERT INTO tenant.procurement_supplier_contact_roles (organization_id, supplier_id, supplier_contact_id, role)
SELECT organization_id, supplier_id, id, CASE role WHEN 'quotation' THEN 'sales' ELSE role END
  FROM tenant.procurement_supplier_contacts
ON CONFLICT DO NOTHING;

-- Defaults: the old default location for the registered purpose (else the registered office); each purpose's oldest active location;
-- the old primary contact as primary.
INSERT INTO tenant.procurement_supplier_defaults (organization_id, supplier_id, registered_address_id, ordering_address_id, billing_address_id, ship_from_address_id,
  return_to_address_id, primary_contact_id)
SELECT supplier.organization_id, supplier.id,
       (SELECT a.id FROM tenant.procurement_supplier_addresses a WHERE a.organization_id = supplier.organization_id AND a.supplier_id = supplier.id AND a.status = 'active'
         ORDER BY a.is_primary DESC, (a.address_type = 'registered') DESC, a.created_at LIMIT 1),
       (SELECT a.id FROM tenant.procurement_supplier_addresses a WHERE a.organization_id = supplier.organization_id AND a.supplier_id = supplier.id AND a.status = 'active'
         ORDER BY (a.address_type = 'ordering') DESC, a.is_primary DESC, a.created_at LIMIT 1),
       (SELECT a.id FROM tenant.procurement_supplier_addresses a WHERE a.organization_id = supplier.organization_id AND a.supplier_id = supplier.id AND a.status = 'active'
           AND a.address_type = 'billing' ORDER BY a.created_at LIMIT 1),
       (SELECT a.id FROM tenant.procurement_supplier_addresses a WHERE a.organization_id = supplier.organization_id AND a.supplier_id = supplier.id AND a.status = 'active'
           AND a.address_type = 'dispatch' ORDER BY a.created_at LIMIT 1),
       NULL,
       (SELECT c.id FROM tenant.procurement_supplier_contacts c WHERE c.organization_id = supplier.organization_id AND c.supplier_id = supplier.id AND c.status = 'active'
         ORDER BY c.is_primary DESC, c.created_at LIMIT 1)
  FROM tenant.procurement_suppliers supplier
ON CONFLICT DO NOTHING;

-- The replaced columns no longer carry anything.
UPDATE tenant.procurement_supplier_addresses SET is_primary = false, gstin = NULL, gst_registration_type = NULL WHERE is_primary OR gstin IS NOT NULL OR gst_registration_type IS NOT NULL;
UPDATE tenant.procurement_supplier_contacts SET is_primary = false WHERE is_primary;

-- ============================================================ 6. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.suppliers.addresses.view', 'View supplier addresses', 'Procurement', 'See a supplier''s locations, their purposes and GST registrations.'),
  ('procurement.suppliers.contacts.view', 'View supplier contacts', 'Procurement', 'See the people at a supplier, their roles and how to reach them.'),
  ('procurement.suppliers.defaults', 'Set supplier defaults', 'Procurement', 'Choose the default location and person for each purpose (ordering, billing, ship-from, RFQs...).'),
  ('procurement.suppliers.addresses.deactivate', 'Deactivate supplier addresses', 'Procurement', 'Take a supplier location out of use for new documents.'),
  ('procurement.suppliers.contacts.deactivate', 'Deactivate supplier contacts', 'Procurement', 'Mark that a person no longer works with you for the supplier.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.suppliers.addresses.view', 'procurement.suppliers.contacts.view'])
 WHERE existing.permission_key IN ('procurement.suppliers.view', 'procurement.suppliers.view_all')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.suppliers.addresses.deactivate', 'procurement.suppliers.defaults'])
 WHERE existing.permission_key = 'procurement.suppliers.addresses'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.suppliers.contacts.deactivate', 'procurement.suppliers.defaults'])
 WHERE existing.permission_key = 'procurement.suppliers.contacts'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0044_supplier_contacts_addresses.sql', 'supplier-contacts-addresses');
