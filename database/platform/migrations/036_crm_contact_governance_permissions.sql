BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.contacts.view_sensitive', 'View sensitive CRM Contact content', 'CRM', 'View Contact email, phone, mobile and private notes within normal record scope.')
ON CONFLICT (key) DO UPDATE SET
  name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('crm.contacts.view_sensitive')
) AS p(permission_key)
WHERE r.is_system=true
  AND r.slug IN (
    'organization_owner','system_administrator','company_administrator',
    'crm_administrator','sales_head','sales_manager','sales_representative',
    'sales_operations','marketing_manager'
  )
ON CONFLICT DO NOTHING;

COMMIT;
