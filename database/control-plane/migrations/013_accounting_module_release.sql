BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('accounting.view', 'View Accounting', 'Accounting', 'View accounting dashboards, ledgers, subledgers and reports.'),
  ('accounting.journal.create', 'Create journal entries', 'Accounting', 'Create and edit draft journal entries.'),
  ('accounting.journal.submit', 'Submit journal entries', 'Accounting', 'Submit balanced journal entries for approval or posting.'),
  ('accounting.journal.approve', 'Approve journal entries', 'Accounting', 'Approve governed journal entries.'),
  ('accounting.journal.post', 'Post journal entries', 'Accounting', 'Post approved journal entries to the general ledger.'),
  ('accounting.journal.reverse', 'Reverse journal entries', 'Accounting', 'Create governed reversal entries for posted journals.'),
  ('accounting.receivables.manage', 'Manage receivables', 'Accounting', 'Create, post, credit and manage customer invoices.'),
  ('accounting.receivables.approve', 'Approve receivables', 'Accounting', 'Approve governed customer invoices before posting.'),
  ('accounting.receipts.manage', 'Manage customer receipts', 'Accounting', 'Record, post and allocate customer receipts.'),
  ('accounting.collections.manage', 'Manage collections', 'Accounting', 'Manage disputes, dunning and customer collection activity.'),
  ('accounting.payables.manage', 'Manage payables', 'Accounting', 'Create and manage supplier bills and adjustments.'),
  ('accounting.payables.approve', 'Approve payables', 'Accounting', 'Approve governed supplier bills before posting.'),
  ('accounting.payments.manage', 'Manage supplier payments', 'Accounting', 'Create, post and allocate supplier payments.'),
  ('accounting.payments.approve', 'Approve supplier payments', 'Accounting', 'Approve governed supplier payments before posting.'),
  ('accounting.bank.manage', 'Manage bank accounts', 'Accounting', 'Manage bank accounts, statements, transfers and cash journals.'),
  ('accounting.bank.reconcile', 'Reconcile bank accounts', 'Accounting', 'Match and reconcile bank statement transactions.'),
  ('accounting.period.manage', 'Manage accounting periods', 'Accounting', 'Open, soft-close, lock and reopen accounting periods.'),
  ('accounting.close.manage', 'Manage financial close', 'Accounting', 'Run governed month, quarter and year-end close checklists.'),
  ('accounting.budget.manage', 'Manage budgets', 'Accounting', 'Create, approve and control accounting budgets and forecasts.'),
  ('accounting.tax.manage', 'Manage tax accounting', 'Accounting', 'Configure tax accounts and manage tax ledgers and returns.'),
  ('accounting.fx.manage', 'Manage foreign currency accounting', 'Accounting', 'Run foreign-currency revaluations and review gains and losses.'),
  ('accounting.intercompany.manage', 'Manage intercompany accounting', 'Accounting', 'Configure due-to/due-from mappings and intercompany postings.'),
  ('accounting.assets.manage', 'Manage fixed assets', 'Accounting', 'Capitalize, depreciate, transfer, impair and dispose fixed assets.'),
  ('accounting.recurring.manage', 'Manage recurring accounting', 'Accounting', 'Manage recurring journals, accruals and deferrals.'),
  ('accounting.consolidation.manage', 'Manage consolidation', 'Accounting', 'Translate, eliminate and consolidate multi-company financial statements.'),
  ('accounting.reports.view', 'View accounting reports', 'Accounting', 'View general ledger, financial statements, aging and reconciliation reports.'),
  ('accounting.settings.manage', 'Manage Accounting settings', 'Accounting', 'Configure ledgers, journals, chart of accounts and posting rules.'),
  ('accounting.audit.view', 'View accounting audit trail', 'Accounting', 'View protected accounting source-to-ledger audit information.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner','accounting.view'),
    ('organization_owner','accounting.journal.create'),
    ('organization_owner','accounting.journal.submit'),
    ('organization_owner','accounting.journal.approve'),
    ('organization_owner','accounting.journal.post'),
    ('organization_owner','accounting.journal.reverse'),
    ('organization_owner','accounting.receivables.manage'),
    ('organization_owner','accounting.receivables.approve'),
    ('organization_owner','accounting.receipts.manage'),
    ('organization_owner','accounting.collections.manage'),
    ('organization_owner','accounting.payables.manage'),
    ('organization_owner','accounting.payables.approve'),
    ('organization_owner','accounting.payments.manage'),
    ('organization_owner','accounting.payments.approve'),
    ('organization_owner','accounting.bank.manage'),
    ('organization_owner','accounting.bank.reconcile'),
    ('organization_owner','accounting.period.manage'),
    ('organization_owner','accounting.close.manage'),
    ('organization_owner','accounting.budget.manage'),
    ('organization_owner','accounting.tax.manage'),
    ('organization_owner','accounting.fx.manage'),
    ('organization_owner','accounting.intercompany.manage'),
    ('organization_owner','accounting.assets.manage'),
    ('organization_owner','accounting.recurring.manage'),
    ('organization_owner','accounting.consolidation.manage'),
    ('organization_owner','accounting.reports.view'),
    ('organization_owner','accounting.settings.manage'),
    ('organization_owner','accounting.audit.view'),

    ('system_administrator','accounting.view'),
    ('system_administrator','accounting.journal.create'),
    ('system_administrator','accounting.journal.submit'),
    ('system_administrator','accounting.journal.approve'),
    ('system_administrator','accounting.journal.post'),
    ('system_administrator','accounting.journal.reverse'),
    ('system_administrator','accounting.receivables.manage'),
    ('system_administrator','accounting.receivables.approve'),
    ('system_administrator','accounting.receipts.manage'),
    ('system_administrator','accounting.collections.manage'),
    ('system_administrator','accounting.payables.manage'),
    ('system_administrator','accounting.payables.approve'),
    ('system_administrator','accounting.payments.manage'),
    ('system_administrator','accounting.payments.approve'),
    ('system_administrator','accounting.bank.manage'),
    ('system_administrator','accounting.bank.reconcile'),
    ('system_administrator','accounting.period.manage'),
    ('system_administrator','accounting.close.manage'),
    ('system_administrator','accounting.budget.manage'),
    ('system_administrator','accounting.tax.manage'),
    ('system_administrator','accounting.fx.manage'),
    ('system_administrator','accounting.intercompany.manage'),
    ('system_administrator','accounting.assets.manage'),
    ('system_administrator','accounting.recurring.manage'),
    ('system_administrator','accounting.consolidation.manage'),
    ('system_administrator','accounting.reports.view'),
    ('system_administrator','accounting.settings.manage'),
    ('system_administrator','accounting.audit.view'),

    ('company_administrator','accounting.view'),
    ('company_administrator','accounting.journal.create'),
    ('company_administrator','accounting.journal.submit'),
    ('company_administrator','accounting.journal.approve'),
    ('company_administrator','accounting.journal.post'),
    ('company_administrator','accounting.journal.reverse'),
    ('company_administrator','accounting.receivables.manage'),
    ('company_administrator','accounting.receivables.approve'),
    ('company_administrator','accounting.receipts.manage'),
    ('company_administrator','accounting.collections.manage'),
    ('company_administrator','accounting.payables.manage'),
    ('company_administrator','accounting.payables.approve'),
    ('company_administrator','accounting.payments.manage'),
    ('company_administrator','accounting.payments.approve'),
    ('company_administrator','accounting.bank.manage'),
    ('company_administrator','accounting.bank.reconcile'),
    ('company_administrator','accounting.period.manage'),
    ('company_administrator','accounting.close.manage'),
    ('company_administrator','accounting.budget.manage'),
    ('company_administrator','accounting.tax.manage'),
    ('company_administrator','accounting.fx.manage'),
    ('company_administrator','accounting.intercompany.manage'),
    ('company_administrator','accounting.assets.manage'),
    ('company_administrator','accounting.recurring.manage'),
    ('company_administrator','accounting.consolidation.manage'),
    ('company_administrator','accounting.reports.view'),
    ('company_administrator','accounting.settings.manage'),
    ('company_administrator','accounting.audit.view'),

    ('finance_manager','accounting.view'),
    ('finance_manager','accounting.journal.create'),
    ('finance_manager','accounting.journal.submit'),
    ('finance_manager','accounting.journal.approve'),
    ('finance_manager','accounting.journal.post'),
    ('finance_manager','accounting.journal.reverse'),
    ('finance_manager','accounting.receivables.manage'),
    ('finance_manager','accounting.receivables.approve'),
    ('finance_manager','accounting.receipts.manage'),
    ('finance_manager','accounting.collections.manage'),
    ('finance_manager','accounting.payables.manage'),
    ('finance_manager','accounting.payables.approve'),
    ('finance_manager','accounting.payments.manage'),
    ('finance_manager','accounting.payments.approve'),
    ('finance_manager','accounting.bank.manage'),
    ('finance_manager','accounting.bank.reconcile'),
    ('finance_manager','accounting.period.manage'),
    ('finance_manager','accounting.close.manage'),
    ('finance_manager','accounting.budget.manage'),
    ('finance_manager','accounting.tax.manage'),
    ('finance_manager','accounting.fx.manage'),
    ('finance_manager','accounting.intercompany.manage'),
    ('finance_manager','accounting.assets.manage'),
    ('finance_manager','accounting.recurring.manage'),
    ('finance_manager','accounting.consolidation.manage'),
    ('finance_manager','accounting.reports.view'),
    ('finance_manager','accounting.settings.manage'),
    ('finance_manager','accounting.audit.view'),

    ('auditor','accounting.view'),
    ('auditor','accounting.reports.view'),
    ('auditor','accounting.audit.view'),
    ('read_only','accounting.view'),
    ('read_only','accounting.reports.view')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, seed.permission_key
FROM roles role
JOIN role_permission_seed seed ON seed.role_slug = role.slug
JOIN permissions permission ON permission.key = seed.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at)
SELECT organization.id, 'accounting', 'Accounting', 'enabled', now()
FROM organizations organization
ON CONFLICT (organization_id, module_key) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'enabled',
  enabled_at = COALESCE(organization_modules.enabled_at, now()),
  updated_at = now();

WITH series_seed(entity_type, prefix) AS (
  VALUES
    ('journal_entry','JE-'),
    ('customer_invoice','INV-'),
    ('customer_credit_note','CN-'),
    ('customer_receipt','RCT-'),
    ('vendor_bill','BILL-'),
    ('vendor_credit_note','VCN-'),
    ('vendor_payment','PAY-'),
    ('bank_statement','BST-'),
    ('accounting_close_run','CLS-'),
    ('accounting_revaluation_run','FXR-'),
    ('fixed_asset','FA-'),
    ('accounting_tax_return','TAX-'),
    ('accounting_consolidation_run','CON-'),
    ('accounting_compliance_request','CMP-'),
    ('accounting_cash_forecast','CF-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT organization.id, seed.entity_type, seed.prefix
FROM organizations organization
CROSS JOIN series_seed seed
ON CONFLICT (organization_id, entity_type) DO NOTHING;

UPDATE billing_plans
SET modules = (
      SELECT jsonb_agg(module_key ORDER BY module_key)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(COALESCE(billing_plans.modules, '[]'::jsonb)) AS module_key
        UNION ALL SELECT 'accounting'
        UNION ALL SELECT 'crm'
        UNION ALL SELECT 'sales'
      ) modules
    ),
    features = CASE
      WHEN features @> '["Financial accounting and close"]'::jsonb THEN features
      ELSE COALESCE(features, '[]'::jsonb) || '["Financial accounting and close"]'::jsonb
    END,
    updated_at = now()
WHERE status = 'active';

UPDATE organization_subscriptions
SET modules_snapshot = (
      SELECT jsonb_agg(module_key ORDER BY module_key)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(COALESCE(organization_subscriptions.modules_snapshot, '[]'::jsonb)) AS module_key
        UNION ALL SELECT 'accounting'
        UNION ALL SELECT 'crm'
        UNION ALL SELECT 'sales'
      ) modules
    ),
    updated_at = now();

COMMIT;
