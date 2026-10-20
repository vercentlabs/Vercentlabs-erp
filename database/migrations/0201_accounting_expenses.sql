-- Finance MVP F7: Expenses.
--
-- 1. Expense categories: the company's one standard classification of what it spends on (Rent, Travel, Office supplies …), each mapped to
--    the expense account it posts to. They are the categories Procurement's direct supplier bills already use (tenant.expense_categories,
--    0050), now also carrying the GST rate usually charged, whether a receipt is needed (and up to what amount none is), a description
--    and an order. Every company gets a starting set — any category it already has with the same code is kept as it is.
-- 2. The expense accounts the starting categories need, under Operating expenses (6640–6690).
-- 3. An expense records its category, the employee who paid it out of pocket (to be reimbursed), how it was paid, a note, why there is
--    no receipt (the payer's declaration) when there is none, and who cancelled it and why. Its files live with the shared attachments.
--
-- Additive and re-runnable.

ALTER TABLE tenant.expense_categories ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE tenant.expense_categories ADD COLUMN IF NOT EXISTS default_gst_rate numeric(7,4) CHECK (default_gst_rate IS NULL OR (default_gst_rate >= 0 AND default_gst_rate <= 100));
ALTER TABLE tenant.expense_categories ADD COLUMN IF NOT EXISTS receipt_required boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.expense_categories ADD COLUMN IF NOT EXISTS receipt_threshold numeric(20,2) NOT NULL DEFAULT 0 CHECK (receipt_threshold >= 0);
ALTER TABLE tenant.expense_categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;

ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES tenant.expense_categories(id);
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS claimant_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS no_receipt_reason text;
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_expenses ADD COLUMN IF NOT EXISTS cancel_reason text;
CREATE INDEX IF NOT EXISTS accounting_expenses_category_idx ON tenant.accounting_expenses (organization_id, category_id);
CREATE INDEX IF NOT EXISTS accounting_expenses_invoice_idx ON tenant.accounting_expenses (organization_id, upper(supplier_invoice_reference)) WHERE supplier_invoice_reference IS NOT NULL;

-- The expense accounts the starting categories need.
INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
  allow_manual_posting, reconciliation_required, control_kind, status, created_by, updated_by)
SELECT ledger.organization_id, ledger.id, parent.id, seed.code, seed.name, 'expense', 'expense', 'debit', false, true, false, NULL, 'active', ledger.created_by, ledger.created_by
  FROM tenant.accounting_ledgers ledger
  CROSS JOIN (VALUES ('6640', 'Travel and conveyance'), ('6650', 'Office supplies and stationery'), ('6660', 'Telephone and internet'),
                     ('6670', 'Professional and legal fees'), ('6680', 'Staff welfare'), ('6690', 'Vehicle and fuel')) AS seed(code, name)
  LEFT JOIN tenant.accounting_accounts parent ON parent.organization_id = ledger.organization_id AND parent.ledger_id = ledger.id AND parent.code = '6000' AND parent.is_group
 WHERE ledger.code = 'PRIMARY'
ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;

-- The starting categories, for every company whose accounts exist.
INSERT INTO tenant.expense_categories (organization_id, code, name, description, account_id, default_gst_rate, receipt_required, receipt_threshold, sort_order,
  created_by, updated_by)
SELECT account.organization_id, seed.code, seed.name, seed.description, account.id, seed.rate, seed.receipt, seed.threshold, seed.sort, ledger.created_by, ledger.created_by
  FROM (VALUES
    ('RENT', 'Rent', 'Office, shop or warehouse rent', '6600', 18::numeric, true, 0::numeric, 10),
    ('UTILITIES', 'Electricity and water', 'Electricity, water and gas bills', '6610', NULL::numeric, true, 0::numeric, 20),
    ('REPAIRS', 'Repairs and maintenance', 'Repairs to premises and equipment, AMC', '6620', 18::numeric, true, 0::numeric, 30),
    ('MARKETING', 'Marketing and advertising', 'Ads, printing of marketing material, events', '6630', 18::numeric, true, 0::numeric, 40),
    ('TRAVEL', 'Travel and conveyance', 'Tickets, hotels, cabs and local conveyance', '6640', NULL::numeric, true, 200::numeric, 50),
    ('OFFICE', 'Office supplies and stationery', 'Stationery, printer supplies, small office items', '6650', 18::numeric, true, 0::numeric, 60),
    ('TELECOM', 'Telephone and internet', 'Mobile, broadband and landline bills', '6660', 18::numeric, true, 0::numeric, 70),
    ('PROFESSIONAL', 'Professional fees', 'CA, legal and consultant fees', '6670', 18::numeric, true, 0::numeric, 80),
    ('STAFF_WELFARE', 'Staff welfare', 'Tea, snacks, team meals and celebrations', '6680', NULL::numeric, true, 500::numeric, 90),
    ('VEHICLE', 'Vehicle and fuel', 'Fuel, parking, tolls and vehicle upkeep', '6690', NULL::numeric, true, 200::numeric, 100),
    ('BANK_CHARGES', 'Bank charges', 'Charges and fees the bank deducts', '6400', 18::numeric, false, 0::numeric, 110),
    ('GENERAL', 'Miscellaneous', 'Anything that fits no other category', '6100', NULL::numeric, true, 0::numeric, 200)
  ) AS seed(code, name, description, account_code, rate, receipt, threshold, sort)
  JOIN tenant.accounting_ledgers ledger ON ledger.code = 'PRIMARY'
  JOIN tenant.accounting_accounts account ON account.organization_id = ledger.organization_id AND account.ledger_id = ledger.id AND account.code = seed.account_code AND NOT account.is_group
ON CONFLICT (organization_id, code) DO NOTHING;

-- Earlier expenses take the category of their account where one matches it.
UPDATE tenant.accounting_expenses expense SET category_id = category.id
  FROM tenant.expense_categories category
 WHERE expense.category_id IS NULL AND category.organization_id = expense.organization_id AND category.account_id = expense.expense_account_id AND category.status = 'active';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0201_accounting_expenses.sql', 'accounting-expenses') ON CONFLICT DO NOTHING;
