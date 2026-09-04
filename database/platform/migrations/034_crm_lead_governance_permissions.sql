BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.leads.view_sensitive', 'View sensitive CRM Lead content', 'CRM', 'View Lead contact details, consent evidence, private notes/communications and sensitive Lead intelligence within normal record scope.'),
  ('crm.saved_views.share', 'Share CRM saved views', 'CRM', 'Publish governed CRM Lead saved views to an authorized sales team or organization audience.')
ON CONFLICT (key) DO UPDATE SET
  name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('crm.leads.view_sensitive'),
  ('crm.saved_views.share')
) AS p(permission_key)
WHERE r.is_system=true
  AND (
    (p.permission_key='crm.leads.view_sensitive' AND r.slug IN (
      'organization_owner','system_administrator','company_administrator',
      'crm_administrator','sales_head','sales_manager','sales_representative',
      'sales_operations','marketing_manager'
    ))
    OR
    (p.permission_key='crm.saved_views.share' AND r.slug IN (
      'organization_owner','system_administrator','company_administrator',
      'crm_administrator','sales_head','sales_manager','sales_operations','marketing_manager'
    ))
  )
ON CONFLICT DO NOTHING;

COMMIT;
