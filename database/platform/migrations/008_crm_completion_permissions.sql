BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.analytics.manage', 'Manage CRM analytics', 'CRM', 'Create governed report definitions, dashboards and dashboard widgets.'),
  ('crm.customization.manage', 'Manage CRM customization', 'CRM', 'Configure tenant-scoped custom objects, custom fields and custom records.'),
  ('crm.partners.manage', 'Manage partner selling', 'CRM', 'Manage partner accounts, registered partner deals and channel attribution.'),
  ('crm.field-sales.manage', 'Manage CRM field sales', 'CRM', 'Plan and record governed customer visits and field-sales execution.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'crm.analytics.manage'),
    ('organization_owner', 'crm.customization.manage'),
    ('organization_owner', 'crm.partners.manage'),
    ('organization_owner', 'crm.field-sales.manage'),
    ('system_administrator', 'crm.analytics.manage'),
    ('system_administrator', 'crm.customization.manage'),
    ('system_administrator', 'crm.partners.manage'),
    ('system_administrator', 'crm.field-sales.manage'),
    ('company_administrator', 'crm.analytics.manage'),
    ('company_administrator', 'crm.customization.manage'),
    ('company_administrator', 'crm.partners.manage'),
    ('company_administrator', 'crm.field-sales.manage'),
    ('sales_manager', 'crm.analytics.manage'),
    ('sales_manager', 'crm.partners.manage'),
    ('sales_manager', 'crm.field-sales.manage'),
    ('employee', 'crm.field-sales.manage')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, seed.permission_key
FROM roles role
JOIN role_permission_seed seed ON seed.role_slug = role.slug
ON CONFLICT DO NOTHING;

COMMIT;
