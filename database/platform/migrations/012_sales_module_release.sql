BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('sales.view', 'View Sales', 'Sales', 'View Sales dashboards, quotations and sales orders.'),
  ('sales.quotation.create', 'Create quotations', 'Sales', 'Create and revise governed sales quotations.'),
  ('sales.quotation.send', 'Send quotations', 'Sales', 'Issue approved quotation revisions to customers.'),
  ('sales.quotation.approve', 'Approve quotations', 'Sales', 'Approve the exact commercial revision of a quotation.'),
  ('sales.quotation.accept_on_behalf', 'Record quotation decisions', 'Sales', 'Record an authorised customer acceptance or rejection.'),
  ('sales.order.create', 'Create sales orders', 'Sales', 'Create sales orders directly or from accepted quotations.'),
  ('sales.order.confirm', 'Confirm sales orders', 'Sales', 'Confirm governed sales orders.'),
  ('sales.order.approve', 'Approve sales orders', 'Sales', 'Approve sales orders and amendments.'),
  ('sales.order.amend', 'Amend sales orders', 'Sales', 'Create governed amendments to confirmed sales orders.'),
  ('sales.order.hold', 'Manage order holds', 'Sales', 'Place and release operational holds on sales orders.'),
  ('sales.order.cancel', 'Cancel sales orders', 'Sales', 'Cancel eligible sales orders with an audit reason.'),
  ('sales.fulfillment.request', 'Request fulfilment', 'Sales', 'Create durable fulfilment requests for Inventory.'),
  ('sales.invoice.request', 'Request invoicing', 'Sales', 'Create durable invoice requests for Accounting.'),
  ('sales.price.override', 'Override sales prices', 'Sales', 'Override calculated prices with a documented reason.'),
  ('sales.margin.view', 'View sales margin', 'Sales', 'View protected cost and gross-margin information.'),
  ('sales.credit.override', 'Override credit controls', 'Sales', 'Override customer credit blocks with a documented reason.'),
  ('sales.reports.view', 'View Sales reports', 'Sales', 'View Sales operational and commercial reports.'),
  ('sales.settings.manage', 'Manage Sales settings', 'Sales', 'Configure Sales controls, approvals, pricing and tax behaviour.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'sales.view'),
    ('organization_owner', 'sales.quotation.create'),
    ('organization_owner', 'sales.quotation.send'),
    ('organization_owner', 'sales.quotation.approve'),
    ('organization_owner', 'sales.quotation.accept_on_behalf'),
    ('organization_owner', 'sales.order.create'),
    ('organization_owner', 'sales.order.confirm'),
    ('organization_owner', 'sales.order.approve'),
    ('organization_owner', 'sales.order.amend'),
    ('organization_owner', 'sales.order.hold'),
    ('organization_owner', 'sales.order.cancel'),
    ('organization_owner', 'sales.fulfillment.request'),
    ('organization_owner', 'sales.invoice.request'),
    ('organization_owner', 'sales.price.override'),
    ('organization_owner', 'sales.margin.view'),
    ('organization_owner', 'sales.credit.override'),
    ('organization_owner', 'sales.reports.view'),
    ('organization_owner', 'sales.settings.manage'),

    ('system_administrator', 'sales.view'),
    ('system_administrator', 'sales.quotation.create'),
    ('system_administrator', 'sales.quotation.send'),
    ('system_administrator', 'sales.quotation.approve'),
    ('system_administrator', 'sales.quotation.accept_on_behalf'),
    ('system_administrator', 'sales.order.create'),
    ('system_administrator', 'sales.order.confirm'),
    ('system_administrator', 'sales.order.approve'),
    ('system_administrator', 'sales.order.amend'),
    ('system_administrator', 'sales.order.hold'),
    ('system_administrator', 'sales.order.cancel'),
    ('system_administrator', 'sales.fulfillment.request'),
    ('system_administrator', 'sales.invoice.request'),
    ('system_administrator', 'sales.price.override'),
    ('system_administrator', 'sales.margin.view'),
    ('system_administrator', 'sales.credit.override'),
    ('system_administrator', 'sales.reports.view'),
    ('system_administrator', 'sales.settings.manage'),

    ('company_administrator', 'sales.view'),
    ('company_administrator', 'sales.quotation.create'),
    ('company_administrator', 'sales.quotation.send'),
    ('company_administrator', 'sales.quotation.approve'),
    ('company_administrator', 'sales.quotation.accept_on_behalf'),
    ('company_administrator', 'sales.order.create'),
    ('company_administrator', 'sales.order.confirm'),
    ('company_administrator', 'sales.order.approve'),
    ('company_administrator', 'sales.order.amend'),
    ('company_administrator', 'sales.order.hold'),
    ('company_administrator', 'sales.order.cancel'),
    ('company_administrator', 'sales.fulfillment.request'),
    ('company_administrator', 'sales.invoice.request'),
    ('company_administrator', 'sales.price.override'),
    ('company_administrator', 'sales.margin.view'),
    ('company_administrator', 'sales.credit.override'),
    ('company_administrator', 'sales.reports.view'),
    ('company_administrator', 'sales.settings.manage'),

    ('sales_manager', 'sales.view'),
    ('sales_manager', 'sales.quotation.create'),
    ('sales_manager', 'sales.quotation.send'),
    ('sales_manager', 'sales.quotation.approve'),
    ('sales_manager', 'sales.quotation.accept_on_behalf'),
    ('sales_manager', 'sales.order.create'),
    ('sales_manager', 'sales.order.confirm'),
    ('sales_manager', 'sales.order.approve'),
    ('sales_manager', 'sales.order.amend'),
    ('sales_manager', 'sales.order.hold'),
    ('sales_manager', 'sales.order.cancel'),
    ('sales_manager', 'sales.fulfillment.request'),
    ('sales_manager', 'sales.invoice.request'),
    ('sales_manager', 'sales.price.override'),
    ('sales_manager', 'sales.margin.view'),
    ('sales_manager', 'sales.reports.view'),
    ('sales_manager', 'sales.settings.manage'),

    ('finance_manager', 'sales.view'),
    ('finance_manager', 'sales.quotation.approve'),
    ('finance_manager', 'sales.order.approve'),
    ('finance_manager', 'sales.invoice.request'),
    ('finance_manager', 'sales.margin.view'),
    ('finance_manager', 'sales.credit.override'),
    ('finance_manager', 'sales.reports.view'),

    ('employee', 'sales.view'),
    ('employee', 'sales.quotation.create'),
    ('employee', 'sales.quotation.send'),
    ('employee', 'sales.order.create'),
    ('employee', 'sales.fulfillment.request'),
    ('employee', 'sales.invoice.request'),
    ('employee', 'sales.reports.view'),

    ('inventory_manager', 'sales.view'),
    ('inventory_manager', 'sales.fulfillment.request'),
    ('inventory_manager', 'sales.reports.view'),

    ('auditor', 'sales.view'),
    ('auditor', 'sales.margin.view'),
    ('auditor', 'sales.reports.view'),
    ('read_only', 'sales.view'),
    ('read_only', 'sales.reports.view')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, seed.permission_key
FROM roles role
JOIN role_permission_seed seed ON seed.role_slug = role.slug
JOIN permissions permission ON permission.key = seed.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at)
SELECT organization.id, 'sales', 'Sales', 'enabled', now()
FROM organizations organization
ON CONFLICT (organization_id, module_key) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'enabled',
  enabled_at = COALESCE(organization_modules.enabled_at, now()),
  updated_at = now();

WITH series_seed(entity_type, prefix) AS (
  VALUES
    ('quotation', 'QUO-'),
    ('sales_order', 'SO-'),
    ('sales_fulfillment_request', 'FUL-'),
    ('sales_invoice_request', 'SIR-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT organization.id, seed.entity_type, seed.prefix
FROM organizations organization
CROSS JOIN series_seed seed
ON CONFLICT (organization_id, entity_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_public_quote_tokens (
  token_hash text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL,
  quotation_version_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_public_quote_tokens_org_idx
  ON sales_public_quote_tokens(organization_id, quotation_id, quotation_version_id);
CREATE INDEX IF NOT EXISTS sales_public_quote_tokens_expiry_idx
  ON sales_public_quote_tokens(expires_at) WHERE revoked_at IS NULL;

UPDATE billing_plans
SET modules = (
      SELECT jsonb_agg(module_key ORDER BY module_key)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(COALESCE(billing_plans.modules, '[]'::jsonb)) AS module_key
        UNION ALL SELECT 'crm'
        UNION ALL SELECT 'sales'
      ) modules
    ),
    features = CASE
      WHEN features @> '["Sales order-to-cash"]'::jsonb THEN features
      ELSE COALESCE(features, '[]'::jsonb) || '["Sales order-to-cash"]'::jsonb
    END,
    updated_at = now()
WHERE status = 'active';

UPDATE organization_subscriptions
SET modules_snapshot = (
      SELECT jsonb_agg(module_key ORDER BY module_key)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(COALESCE(organization_subscriptions.modules_snapshot, '[]'::jsonb)) AS module_key
        UNION ALL SELECT 'crm'
        UNION ALL SELECT 'sales'
      ) modules
    ),
    updated_at = now();

COMMIT;
