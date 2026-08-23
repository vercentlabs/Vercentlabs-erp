BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  (
    'business_data.view',
    'View business data',
    'Master data',
    'View shared business partners, products, warehouses and finance master data.'
  ),
  (
    'parties.manage',
    'Manage business partners',
    'Master data',
    'Create and maintain customers, suppliers, contacts and addresses.'
  ),
  (
    'items.manage',
    'Manage item masters',
    'Master data',
    'Create and maintain items, services, groups and units of measure.'
  ),
  (
    'inventory_setup.manage',
    'Manage inventory setup',
    'Master data',
    'Create and maintain warehouses and warehouse locations.'
  ),
  (
    'finance_setup.manage',
    'Manage finance setup',
    'Master data',
    'Create and maintain currencies, taxes, fiscal periods, payment terms and price lists.'
  ),
  (
    'business_data.import',
    'Import business data',
    'Master data',
    'Run governed master-data imports and review import outcomes.'
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'business_data.view'),
    ('organization_owner', 'parties.manage'),
    ('organization_owner', 'items.manage'),
    ('organization_owner', 'inventory_setup.manage'),
    ('organization_owner', 'finance_setup.manage'),
    ('organization_owner', 'business_data.import'),

    ('system_administrator', 'business_data.view'),
    ('system_administrator', 'parties.manage'),
    ('system_administrator', 'items.manage'),
    ('system_administrator', 'inventory_setup.manage'),
    ('system_administrator', 'finance_setup.manage'),
    ('system_administrator', 'business_data.import'),

    ('company_administrator', 'business_data.view'),
    ('company_administrator', 'parties.manage'),
    ('company_administrator', 'items.manage'),
    ('company_administrator', 'inventory_setup.manage'),
    ('company_administrator', 'finance_setup.manage'),
    ('company_administrator', 'business_data.import'),

    ('finance_manager', 'business_data.view'),
    ('finance_manager', 'parties.manage'),
    ('finance_manager', 'finance_setup.manage'),

    ('sales_manager', 'business_data.view'),
    ('sales_manager', 'parties.manage'),

    ('purchase_manager', 'business_data.view'),
    ('purchase_manager', 'parties.manage'),

    ('inventory_manager', 'business_data.view'),
    ('inventory_manager', 'items.manage'),
    ('inventory_manager', 'inventory_setup.manage'),

    ('manufacturing_manager', 'business_data.view'),
    ('manufacturing_manager', 'items.manage'),
    ('manufacturing_manager', 'inventory_setup.manage'),

    ('hr_manager', 'business_data.view'),
    ('employee', 'business_data.view'),
    ('auditor', 'business_data.view'),
    ('read_only', 'business_data.view')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, seed.permission_key
FROM roles r
JOIN role_permission_seed seed
  ON seed.role_slug = r.slug
ON CONFLICT DO NOTHING;

WITH series_seed(entity_type, prefix) AS (
  VALUES
    ('business_party', 'PTY-'),
    ('contact', 'CON-'),
    ('item', 'ITM-'),
    ('warehouse', 'WH-'),
    ('price_list', 'PL-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT o.id, seed.entity_type, seed.prefix
FROM organizations o
CROSS JOIN series_seed seed
ON CONFLICT (organization_id, entity_type) DO NOTHING;

COMMIT;
