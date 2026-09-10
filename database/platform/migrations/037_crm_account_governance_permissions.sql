BEGIN;

-- CRM vNext Prompt 3 (CRM-VNEXT-004/035): Account legal/tax identifiers
-- (GSTIN, PAN, MSME registration number) previously had no dedicated
-- sensitive-content permission — any caller with ordinary crm.view/account
-- record access received them unconditionally. Mirrors the established
-- crm.contacts.view_sensitive pattern (036_crm_contact_governance_permissions.sql)
-- exactly, including the same system-role grant list.
INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.accounts.view_sensitive', 'View sensitive CRM Account content', 'CRM', 'View Account GSTIN, PAN and MSME registration number within normal record scope.')
ON CONFLICT (key) DO UPDATE SET
  name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('crm.accounts.view_sensitive')
) AS p(permission_key)
WHERE r.is_system=true
  AND r.slug IN (
    'organization_owner','system_administrator','company_administrator',
    'crm_administrator','sales_head','sales_manager','sales_representative',
    'sales_operations','marketing_manager'
  )
ON CONFLICT DO NOTHING;

COMMIT;
