BEGIN;

-- Expands the Quality foundation (migrations 049, 072) into the full desk: use-as-is approval
-- (maker-checker) and cost on the nonconformance; AQL sampling plans; calibration; certificates of
-- analysis; quality documents; and customer quality complaints (optionally linked to a Support
-- ticket). customer/item/supplier ids stay loosely typed uuids (no FK), the same convention every
-- other module uses for tenant.business_parties/tenant.items references.

ALTER TABLE tenant.quality_nonconformances
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(20,2),
  ADD COLUMN IF NOT EXISTS use_as_is_reason text,
  ADD COLUMN IF NOT EXISTS use_as_is_requested_by uuid,
  ADD COLUMN IF NOT EXISTS use_as_is_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS use_as_is_approved_by uuid,
  ADD COLUMN IF NOT EXISTS use_as_is_approved_at timestamptz;

-- F315: AQL-style sampling plans -- a sample size (and accept/reject numbers) looked up by lot-size
-- range, for a quality_plans row whose sampling_method='aql'.
CREATE TABLE IF NOT EXISTS tenant.quality_sampling_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  aql_level text NOT NULL DEFAULT 'II',
  lot_size_from integer NOT NULL CHECK (lot_size_from > 0),
  lot_size_to integer,
  sample_size integer NOT NULL CHECK (sample_size > 0),
  acceptance_number integer NOT NULL DEFAULT 0 CHECK (acceptance_number >= 0),
  rejection_number integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code),
  CHECK (rejection_number >= acceptance_number),
  CHECK (lot_size_to IS NULL OR lot_size_to >= lot_size_from)
);

-- F336: calibration of measuring/test equipment -- an asset (if tracked in Assets) or free-text
-- equipment identity, a due date that drives a "calibration overdue" exception.
CREATE TABLE IF NOT EXISTS tenant.quality_calibration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  calibration_number text NOT NULL,
  asset_id uuid,
  equipment_name text NOT NULL,
  equipment_identifier text,
  calibration_date date NOT NULL,
  due_date date NOT NULL,
  standard_used text,
  performed_by_text text,
  result text NOT NULL DEFAULT 'pass' CHECK (result IN ('pass', 'fail', 'adjusted')),
  certificate_reference text,
  notes text,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'expired', 'superseded')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= calibration_date)
);
CREATE INDEX IF NOT EXISTS quality_calibration_due_idx ON tenant.quality_calibration_records(organization_id, company_id, status, due_date);

-- F338: a certificate of analysis issued off the back of an inspection (or standalone).
CREATE TABLE IF NOT EXISTS tenant.quality_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  certificate_number text NOT NULL,
  inspection_id uuid REFERENCES tenant.quality_inspections(id),
  item_id uuid,
  batch_id uuid,
  serial_id uuid,
  party_id uuid,
  summary text NOT NULL,
  content text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'void')),
  issued_by uuid,
  issued_at timestamptz,
  voided_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, certificate_number)
);

-- F340: controlled quality documents (procedures, work instructions, forms, specs), versioned and
-- approved before use -- the same draft/review/approve shape as Support's knowledge base.
CREATE TABLE IF NOT EXISTS tenant.quality_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  document_number text NOT NULL,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'procedure' CHECK (document_type IN ('procedure', 'work_instruction', 'form', 'specification', 'policy', 'other')),
  category text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'obsolete')),
  content text,
  storage_key text,
  linked_plan_id uuid REFERENCES tenant.quality_plans(id),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_number, version)
);

-- F335: a customer's quality complaint, optionally linked to a Support ticket (cross-module, read
-- through only -- Quality does not own Support's ticket data) and to the resulting nonconformance.
CREATE TABLE IF NOT EXISTS tenant.quality_customer_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  complaint_number text NOT NULL,
  party_id uuid,
  contact_id uuid,
  support_ticket_id uuid,
  item_id uuid,
  batch_id uuid,
  serial_id uuid,
  severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'critical')),
  description text NOT NULL,
  nonconformance_id uuid REFERENCES tenant.quality_nonconformances(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed', 'cancelled')),
  resolution text,
  received_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, complaint_number)
);
CREATE INDEX IF NOT EXISTS quality_complaints_status_idx ON tenant.quality_customer_complaints(organization_id, company_id, status, severity);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'quality_sampling_plans',
    'quality_calibration_records',
    'quality_certificates',
    'quality_documents',
    'quality_customer_complaints'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON tenant.%I', table_name || '_organization_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
