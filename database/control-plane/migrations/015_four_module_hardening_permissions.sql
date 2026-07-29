BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('accounting.close.waive', 'Waive financial close tasks', 'Accounting', 'Waive a close task only with a documented reason and supporting evidence.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH allowed_roles(role_slug) AS (
  VALUES
    ('organization_owner'),
    ('system_administrator'),
    ('company_administrator'),
    ('finance_manager')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, 'accounting.close.waive'
FROM roles role
JOIN allowed_roles allowed ON allowed.role_slug = role.slug
ON CONFLICT DO NOTHING;

COMMIT;
