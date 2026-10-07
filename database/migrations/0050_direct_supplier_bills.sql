-- Direct Supplier Bills (without a purchase order): rent, utilities, internet, subscriptions, professional fees, repairs, freight, consumables.
-- Not a new document: a supplier bill with source_type 'direct' (migration 0049). This adds what the direct workflow needs:
--
--  * expense categories: user-friendly names (Rent, Electricity, Internet…) mapped to the Finance account they post to, with a default tax
--    category and HSN/SAC; managed by whoever manages accounting classifications.
--  * per line, whether its input tax is claimable (eligible) or a blocked credit, which Finance books into the cost instead of input tax.
--  * the due date worked out from the payment terms, and an audited override (who, why) when the invoice's agreed date differs.
--  * creating and editing draft bills as its own permission, separate from posting them to Accounts Payable.

CREATE TABLE IF NOT EXISTS tenant.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id),
  default_tax_category_id uuid REFERENCES tenant.tax_categories(id),
  default_hsn_sac text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE tenant.expense_categories ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE tenant.expense_categories FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY organization_isolation ON tenant.expense_categories USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.expense_categories TO vercent_app';
  EXECUTE 'GRANT SELECT ON tenant.expense_categories TO vercent_worker';
END $$;

ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS expense_category_id uuid;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD CONSTRAINT accounting_vendor_bill_lines_expense_category_fk
  FOREIGN KEY (organization_id, expense_category_id) REFERENCES tenant.expense_categories(organization_id, id);
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS input_tax_eligibility text NOT NULL DEFAULT 'eligible'
  CHECK (input_tax_eligibility IN ('eligible', 'blocked'));

ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS computed_due_date date;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS due_date_override_reason text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS due_date_override_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.bills.create', 'Create supplier bills', 'Procurement', 'Record and edit draft supplier bills (including direct bills without a PO). Posting them is Accounts Payable''s.'),
  ('procurement.bills.override_due_date', 'Override supplier bill due dates', 'Procurement', 'Set a due date other than the payment terms give, with a reason kept on the bill.'),
  ('procurement.bills.categories', 'Manage expense categories', 'Procurement', 'Maintain the expense categories direct bills are classified with, and the accounts they post to.')
ON CONFLICT (key) DO NOTHING;
-- Drafts by Accounts Payable and buyers; due-date overrides by whoever approves payables; expense classification by payables approvers and
-- whoever manages procurement settings.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES
    ('accounting.payables.manage', 'procurement.bills.create'), ('procurement.po.manage', 'procurement.bills.create'),
    ('accounting.payables.approve', 'procurement.bills.override_due_date'),
    ('accounting.payables.approve', 'procurement.bills.categories'), ('procurement.settings.manage', 'procurement.bills.categories')
  ) AS granted(source, key) ON granted.source = existing.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0050_direct_supplier_bills.sql', 'direct-supplier-bills');
