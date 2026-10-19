-- Shared Platform plan, step 3: company and user basics.
--
-- 1. The company profile printed on documents: legal identity (PAN, CIN, Udyam), address, contact, logo, UPI. The GSTIN stays on
--    tenant.tax_registrations (one per state); the setup wizard creates the first one. organizations.tax_id keeps the PAN for older
--    readers.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS pan text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  ADD COLUMN IF NOT EXISTS cin text CHECK (cin IS NULL OR cin ~ '^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$'),
  ADD COLUMN IF NOT EXISTS udyam_number text CHECK (udyam_number IS NULL OR udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state_code text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS logo_file_id uuid,
  ADD COLUMN IF NOT EXISTS upi_id text CHECK (upi_id IS NULL OR upi_id ~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z]{2,64}$'),
  -- Closing the workspace: requested, then closed after the waiting period (the owner may cancel until then).
  ADD COLUMN IF NOT EXISTS closure_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_requested_by uuid,
  ADD COLUMN IF NOT EXISTS closure_scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- 2. The bank accounts printed on invoices for customers to pay into (not the accounting bank ledger).
CREATE TABLE IF NOT EXISTS tenant.company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_name text NOT NULL CHECK (length(account_name) BETWEEN 1 AND 200),
  bank_name text NOT NULL CHECK (length(bank_name) BETWEEN 1 AND 200),
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{6,20}$'),
  ifsc text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  branch text,
  account_type text NOT NULL DEFAULT 'current' CHECK (account_type IN ('current', 'savings', 'cash_credit', 'overdraft')),
  is_default boolean NOT NULL DEFAULT false,
  show_on_documents boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_bank_accounts_default_uidx ON tenant.company_bank_accounts (organization_id) WHERE is_default AND status = 'active';
ALTER TABLE tenant.company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.company_bank_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.company_bank_accounts;
CREATE POLICY organization_isolation ON tenant.company_bank_accounts USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.company_bank_accounts TO vercent_app, vercent_worker;

-- 3. A person's own profile and preferences.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'DD/MM/YYYY'
  CHECK (date_format IN ('DD/MM/YYYY', 'DD-MM-YYYY', 'DD MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'));
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS number_format text NOT NULL DEFAULT 'indian' CHECK (number_format IN ('indian', 'international'));

-- Changing one's email: a link to the NEW address confirms it (AUTH_IDENTITY, like the other token tables).
CREATE TABLE IF NOT EXISTS public.email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  new_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_change_requests_user_idx ON public.email_change_requests (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_change_requests TO vercent_app;

-- Which device a sign-in came from, so a sign-in from a new one is emailed to the person.
ALTER TABLE public.login_events ADD COLUMN IF NOT EXISTS device_fingerprint text;
ALTER TABLE public.login_events ADD COLUMN IF NOT EXISTS new_device boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS login_events_user_device_idx ON public.login_events (user_id, device_fingerprint) WHERE succeeded;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0187_platform_company_user_basics.sql', 'platform-company-user-basics') ON CONFLICT DO NOTHING;
