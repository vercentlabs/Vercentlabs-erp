-- Payment Terms: one shared master and one due-date engine for Procurement, Sales and Finance.
--
--  1. tenant.payment_terms: what kind of term it is (immediate, net days, invoice-received based, end of month, fixed day of a month,
--     instalments, advance), which buying company it is scoped to (none: every company), its version and, for an advance term, the
--     advance the purchase order expects. calculation_type stays as Sales reads it (due_on_receipt / net_days / custom).
--  2. tenant.payment_term_lines: each rule — its share, the date it counts from (invoice date, invoice received date, posting date)
--     and how (N days after; month-end of the reference month (+ months) + N days; a fixed day of the reference month (+ months)).
--  3. tenant.payment_term_versions: the rules of each version of a term, as they were. Documents keep their own snapshot.
--  4. Defaults: the company's default purchase term (procurement settings); the supplier's own stays on the supplier.
--  5. Suppliers: their micro / small / medium enterprise classification (MSMED Act), its evidence and effective date, and the written
--     payment agreement (days) — what the statutory payment deadline is worked out from.
--  6. Purchase orders: the advance the order expects and the payment notes. Supplier advances record which order they are for.
--  7. Supplier bills: the invoice received date, the terms the supplier's invoice states, and why the agreed terms were changed.
--  8. Bill schedules: each instalment's share, the date it was counted from, and its original due date beside the one in force;
--     tenant.accounting_vendor_bill_schedule_changes: requested and approved reschedules.
--  9. tenant.supplier_payment_compliance_deadlines: the statutory payment deadline per acceptance (receipt) of a bill — separate
--     from the commercial schedule and from Accounts Payable.
-- 10. Permissions.

-- ---------------------------------------------------------------- 1. terms
ALTER TABLE tenant.payment_terms
  ADD COLUMN IF NOT EXISTS term_type text,
  ADD COLUMN IF NOT EXISTS buying_registration_id uuid,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS advance_percentage numeric(9,4);
UPDATE tenant.payment_terms SET term_type = CASE calculation_type WHEN 'due_on_receipt' THEN 'immediate' WHEN 'custom' THEN 'custom' ELSE 'net_days' END
 WHERE term_type IS NULL;
ALTER TABLE tenant.payment_terms ALTER COLUMN term_type SET DEFAULT 'net_days';
ALTER TABLE tenant.payment_terms ALTER COLUMN term_type SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_terms_term_type_check') THEN
    ALTER TABLE tenant.payment_terms ADD CONSTRAINT payment_terms_term_type_check
      CHECK (term_type IN ('immediate', 'net_days', 'invoice_receipt', 'end_of_month', 'fixed_day', 'installments', 'advance', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_terms_advance_percentage_check') THEN
    ALTER TABLE tenant.payment_terms ADD CONSTRAINT payment_terms_advance_percentage_check
      CHECK (advance_percentage IS NULL OR (advance_percentage > 0 AND advance_percentage < 100));
  END IF;
END $$;

-- ---------------------------------------------------------------- 2. rules
ALTER TABLE tenant.payment_term_lines
  ADD COLUMN IF NOT EXISTS reference_basis text NOT NULL DEFAULT 'invoice_date',
  ADD COLUMN IF NOT EXISTS rule_kind text NOT NULL DEFAULT 'days',
  ADD COLUMN IF NOT EXISTS months_offset integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS day_of_month integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_term_lines_reference_basis_check') THEN
    ALTER TABLE tenant.payment_term_lines ADD CONSTRAINT payment_term_lines_reference_basis_check
      CHECK (reference_basis IN ('invoice_date', 'invoice_received', 'posting_date'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_term_lines_rule_kind_check') THEN
    ALTER TABLE tenant.payment_term_lines ADD CONSTRAINT payment_term_lines_rule_kind_check
      CHECK (rule_kind IN ('days', 'end_of_month', 'fixed_day') AND months_offset BETWEEN 0 AND 12 AND (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31)
        AND (rule_kind <> 'fixed_day' OR day_of_month IS NOT NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------- 3. versions
CREATE TABLE IF NOT EXISTS tenant.payment_term_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_term_id uuid NOT NULL REFERENCES tenant.payment_terms(id),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, payment_term_id, version)
);

-- ---------------------------------------------------------------- 4. defaults
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS default_payment_term_id uuid;

-- ---------------------------------------------------------------- 5. suppliers
ALTER TABLE tenant.procurement_suppliers
  ADD COLUMN IF NOT EXISTS msme_classification text,
  ADD COLUMN IF NOT EXISTS msme_registration_number text,
  ADD COLUMN IF NOT EXISTS msme_effective_from date,
  ADD COLUMN IF NOT EXISTS msme_evidence_reference text,
  ADD COLUMN IF NOT EXISTS written_payment_agreement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_payment_days integer,
  ADD COLUMN IF NOT EXISTS payment_agreement_reference text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_suppliers_msme_classification_check') THEN
    ALTER TABLE tenant.procurement_suppliers ADD CONSTRAINT procurement_suppliers_msme_classification_check
      CHECK ((msme_classification IS NULL OR msme_classification IN ('micro', 'small', 'medium', 'not_msme')) AND (agreed_payment_days IS NULL OR agreed_payment_days BETWEEN 0 AND 3650));
  END IF;
END $$;

-- ---------------------------------------------------------------- 6. purchase orders and advances
ALTER TABLE tenant.purchase_orders
  ADD COLUMN IF NOT EXISTS advance_percentage numeric(9,4),
  ADD COLUMN IF NOT EXISTS advance_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS payment_terms_note text,
  ADD COLUMN IF NOT EXISTS payment_term_change_reason text;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS purchase_order_id uuid;
CREATE INDEX IF NOT EXISTS accounting_vendor_payments_order_idx ON tenant.accounting_vendor_payments (organization_id, purchase_order_id) WHERE purchase_order_id IS NOT NULL;

-- ---------------------------------------------------------------- 7. supplier bills
ALTER TABLE tenant.accounting_vendor_bills
  ADD COLUMN IF NOT EXISTS invoice_received_date date,
  ADD COLUMN IF NOT EXISTS supplier_stated_terms text,
  ADD COLUMN IF NOT EXISTS supplier_stated_term_id uuid,
  ADD COLUMN IF NOT EXISTS payment_term_change_reason text,
  ADD COLUMN IF NOT EXISTS acceptance_date date;

-- ---------------------------------------------------------------- 8. schedules and reschedules
ALTER TABLE tenant.accounting_vendor_bill_schedules
  ADD COLUMN IF NOT EXISTS percentage numeric(9,4),
  ADD COLUMN IF NOT EXISTS reference_basis text,
  ADD COLUMN IF NOT EXISTS reference_date date,
  ADD COLUMN IF NOT EXISTS original_due_date date,
  ADD COLUMN IF NOT EXISTS rule_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
UPDATE tenant.accounting_vendor_bill_schedules SET original_due_date = due_date WHERE original_due_date IS NULL;

CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_bill_schedule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  schedule_id uuid NOT NULL,
  previous_due_date date NOT NULL,
  requested_due_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected')),
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS accounting_vendor_bill_schedule_changes_bill_idx ON tenant.accounting_vendor_bill_schedule_changes (organization_id, vendor_bill_id);

-- ---------------------------------------------------------------- 9. statutory deadlines
CREATE TABLE IF NOT EXISTS tenant.supplier_payment_compliance_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  goods_receipt_id uuid,
  source_reference text NOT NULL,
  classification_snapshot jsonb NOT NULL,
  acceptance_date date NOT NULL,
  acceptance_basis text NOT NULL CHECK (acceptance_basis IN ('accepted', 'deemed', 'objection_resolved')),
  agreement_basis text NOT NULL CHECK (agreement_basis IN ('written_agreement', 'no_agreement')),
  agreed_days integer,
  statutory_days integer NOT NULL,
  statutory_due_date date NOT NULL,
  applicable_amount numeric(24,6) NOT NULL,
  disputed boolean NOT NULL DEFAULT false,
  dispute_reference text,
  dispute_raised_on date,
  dispute_resolved_on date,
  calculation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'superseded', 'void')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_payment_compliance_deadlines_bill_idx ON tenant.supplier_payment_compliance_deadlines (organization_id, vendor_bill_id, status);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['payment_term_versions', 'accounting_vendor_bill_schedule_changes', 'supplier_payment_compliance_deadlines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT UPDATE ON tenant.payment_term_events TO vercent_app;

-- ---------------------------------------------------------------- 10. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.po.change_payment_terms', 'Change purchase order payment terms', 'Procurement', 'Agree payment terms on a purchase order other than the supplier''s or the company default.'),
  ('procurement.bills.override_payment_terms', 'Change a supplier bill''s agreed payment terms', 'Procurement', 'Apply payment terms on a supplier bill other than the agreed ones, with a reason.'),
  ('accounting.payables.reschedule', 'Approve payment reschedules', 'Accounting', 'Approve a revised due date for a posted supplier bill instalment.'),
  ('procurement.compliance.view', 'View supplier payment compliance', 'Procurement', 'See statutory payment deadlines (MSMED Act) and their alerts.')
ON CONFLICT (key) DO NOTHING;
UPDATE public.permissions SET category = 'Finance & Commercial' WHERE key IN ('payment_terms.view', 'payment_terms.manage', 'payment_terms.set_default');
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES
    ('procurement.po.create', 'procurement.po.change_payment_terms'), ('procurement.po.manage', 'procurement.po.change_payment_terms'),
    ('accounting.payables.manage', 'procurement.bills.override_payment_terms'),
    ('accounting.payables.approve', 'accounting.payables.reschedule'),
    ('procurement.po.view', 'procurement.compliance.view'), ('accounting.payables.manage', 'procurement.compliance.view'), ('accounting.view', 'procurement.compliance.view'),
    ('procurement.po.view', 'payment_terms.view'), ('accounting.payables.manage', 'payment_terms.view'),
    ('procurement.settings.manage', 'payment_terms.manage'), ('procurement.settings.manage', 'payment_terms.set_default'),
    ('accounting.settings.manage', 'payment_terms.manage'), ('accounting.settings.manage', 'payment_terms.set_default')
  ) AS granted(source, key) ON granted.source = existing.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0056_payment_terms_engine.sql', 'payment-terms-engine');
