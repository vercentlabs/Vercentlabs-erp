BEGIN;

-- Keep role permissions created after the original onboarding code synchronized
-- for organizations that already exist.
WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'crm.revenue.manage'),
    ('organization_owner', 'crm.accounts.manage'),
    ('organization_owner', 'crm.playbooks.manage'),
    ('organization_owner', 'crm.privacy.manage'),
    ('organization_owner', 'crm.data-quality.manage'),
    ('organization_owner', 'crm.integrations.manage'),
    ('organization_owner', 'crm.ai.manage'),
    ('organization_owner', 'crm.analytics.manage'),
    ('organization_owner', 'crm.customization.manage'),
    ('organization_owner', 'crm.partners.manage'),
    ('organization_owner', 'crm.field-sales.manage'),

    ('system_administrator', 'crm.revenue.manage'),
    ('system_administrator', 'crm.accounts.manage'),
    ('system_administrator', 'crm.playbooks.manage'),
    ('system_administrator', 'crm.privacy.manage'),
    ('system_administrator', 'crm.data-quality.manage'),
    ('system_administrator', 'crm.integrations.manage'),
    ('system_administrator', 'crm.ai.manage'),
    ('system_administrator', 'crm.analytics.manage'),
    ('system_administrator', 'crm.customization.manage'),
    ('system_administrator', 'crm.partners.manage'),
    ('system_administrator', 'crm.field-sales.manage'),

    ('company_administrator', 'crm.revenue.manage'),
    ('company_administrator', 'crm.accounts.manage'),
    ('company_administrator', 'crm.playbooks.manage'),
    ('company_administrator', 'crm.privacy.manage'),
    ('company_administrator', 'crm.data-quality.manage'),
    ('company_administrator', 'crm.integrations.manage'),
    ('company_administrator', 'crm.analytics.manage'),
    ('company_administrator', 'crm.customization.manage'),
    ('company_administrator', 'crm.partners.manage'),
    ('company_administrator', 'crm.field-sales.manage'),

    ('sales_manager', 'crm.revenue.manage'),
    ('sales_manager', 'crm.accounts.manage'),
    ('sales_manager', 'crm.playbooks.manage'),
    ('sales_manager', 'crm.data-quality.manage'),
    ('sales_manager', 'crm.analytics.manage'),
    ('sales_manager', 'crm.partners.manage'),
    ('sales_manager', 'crm.field-sales.manage'),

    ('employee', 'crm.accounts.manage'),
    ('employee', 'crm.playbooks.manage'),
    ('employee', 'crm.field-sales.manage'),
    ('auditor', 'crm.privacy.manage')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, seed.permission_key
FROM roles role
JOIN role_permission_seed seed ON seed.role_slug = role.slug
JOIN permissions permission ON permission.key = seed.permission_key
ON CONFLICT DO NOTHING;

-- CRM is the only released business module in this milestone. Register every
-- roadmap module but make it impossible for an existing tenant to leave a
-- placeholder module enabled.
WITH module_seed(module_key, name, status) AS (
  VALUES
    ('accounting', 'Accounting', 'disabled'),
    ('procurement', 'Procurement', 'disabled'),
    ('sales', 'Sales', 'disabled'),
    ('crm', 'CRM', 'enabled'),
    ('stock', 'Stock', 'disabled'),
    ('manufacturing', 'Manufacturing', 'disabled'),
    ('projects', 'Projects', 'disabled'),
    ('assets', 'Assets', 'disabled'),
    ('point-of-sale', 'Point of Sale', 'disabled'),
    ('quality', 'Quality', 'disabled'),
    ('support', 'Support', 'disabled'),
    ('hr-payroll', 'HR & Payroll', 'disabled')
)
INSERT INTO organization_modules (
  organization_id, module_key, name, status, enabled_at
)
SELECT
  organization.id,
  seed.module_key,
  seed.name,
  seed.status,
  CASE WHEN seed.status = 'enabled' THEN now() ELSE NULL END
FROM organizations organization
CROSS JOIN module_seed seed
ON CONFLICT (organization_id, module_key) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  enabled_at = CASE
    WHEN EXCLUDED.status = 'enabled'
      THEN COALESCE(organization_modules.enabled_at, now())
    ELSE NULL
  END,
  updated_at = now();

WITH series_seed(entity_type, prefix) AS (
  VALUES
    ('crm_lead', 'LEAD-'),
    ('crm_opportunity', 'OPP-'),
    ('crm_campaign', 'CMP-'),
    ('crm_activity', 'ACT-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT organization.id, seed.entity_type, seed.prefix
FROM organizations organization
CROSS JOIN series_seed seed
ON CONFLICT (organization_id, entity_type) DO NOTHING;

-- Billing limits can differ by plan, but module entitlement must describe only
-- capabilities that are actually released.
UPDATE billing_plans
SET
  modules = '["crm"]'::jsonb,
  description = CASE code
    WHEN 'founder-preview' THEN 'Internal preview access to the released CRM and platform foundation.'
    WHEN 'launch' THEN 'For small businesses adopting CRM and governed master data.'
    WHEN 'growth' THEN 'For multi-team businesses scaling CRM usage and governance.'
    WHEN 'scale' THEN 'For growing multi-company organisations requiring deeper CRM controls and higher usage.'
    WHEN 'enterprise' THEN 'For dedicated CRM infrastructure, migration programmes, custom integrations and contracted service levels.'
    ELSE description
  END,
  features = CASE code
    WHEN 'founder-preview' THEN '["Unlimited users", "Released CRM capabilities", "Development support"]'::jsonb
    WHEN 'launch' THEN '["Unlimited users", "1 company and 2 branches", "CRM and master data", "Core platform controls", "Email support"]'::jsonb
    WHEN 'growth' THEN '["Unlimited users", "3 companies and 10 branches", "Advanced CRM controls", "Higher automation limits", "Priority email support"]'::jsonb
    WHEN 'scale' THEN '["Unlimited users", "10 companies and 50 branches", "CRM analytics and governance", "Integration allowances", "Priority support"]'::jsonb
    WHEN 'enterprise' THEN '["Unlimited users", "Contracted organisation limits", "Dedicated or private deployment options", "Custom CRM integrations", "Contracted SLA"]'::jsonb
    ELSE features
  END,
  updated_at = now()
WHERE code IN ('founder-preview', 'launch', 'growth', 'scale', 'enterprise');

UPDATE organization_subscriptions
SET modules_snapshot = '["crm"]'::jsonb, updated_at = now()
WHERE modules_snapshot IS DISTINCT FROM '["crm"]'::jsonb;

COMMIT;
