BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.revenue.manage', 'Manage CRM revenue operations', 'CRM', 'Manage sales teams, territories, quotas, forecast periods, submissions and manager adjustments.'),
  ('crm.accounts.manage', 'Manage strategic accounts', 'CRM', 'Manage account plans, stakeholder maps, health, renewals and expansion opportunities.'),
  ('crm.playbooks.manage', 'Manage sales playbooks', 'CRM', 'Configure qualification frameworks, required stage evidence and guided selling playbooks.'),
  ('crm.privacy.manage', 'Manage CRM privacy', 'CRM', 'Manage consent evidence, suppression, privacy requests, retention and data-subject workflows.'),
  ('crm.data-quality.manage', 'Manage CRM data quality', 'CRM', 'Manage data-quality scoring, duplicates, completeness, validation and remediation.'),
  ('crm.integrations.manage', 'Manage CRM integrations', 'CRM', 'Manage inbox, calendar, telephony, messaging and provider-neutral synchronization settings.'),
  ('crm.ai.manage', 'Manage CRM AI', 'CRM', 'Configure approved AI providers, suggestions, coaching, predictions and human review controls.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'crm.revenue.manage'),
    ('organization_owner', 'crm.accounts.manage'),
    ('organization_owner', 'crm.playbooks.manage'),
    ('organization_owner', 'crm.privacy.manage'),
    ('organization_owner', 'crm.data-quality.manage'),
    ('organization_owner', 'crm.integrations.manage'),
    ('organization_owner', 'crm.ai.manage'),

    ('system_administrator', 'crm.revenue.manage'),
    ('system_administrator', 'crm.accounts.manage'),
    ('system_administrator', 'crm.playbooks.manage'),
    ('system_administrator', 'crm.privacy.manage'),
    ('system_administrator', 'crm.data-quality.manage'),
    ('system_administrator', 'crm.integrations.manage'),
    ('system_administrator', 'crm.ai.manage'),

    ('company_administrator', 'crm.revenue.manage'),
    ('company_administrator', 'crm.accounts.manage'),
    ('company_administrator', 'crm.playbooks.manage'),
    ('company_administrator', 'crm.privacy.manage'),
    ('company_administrator', 'crm.data-quality.manage'),
    ('company_administrator', 'crm.integrations.manage'),

    ('sales_manager', 'crm.revenue.manage'),
    ('sales_manager', 'crm.accounts.manage'),
    ('sales_manager', 'crm.playbooks.manage'),
    ('sales_manager', 'crm.data-quality.manage'),

    ('employee', 'crm.accounts.manage'),
    ('employee', 'crm.playbooks.manage'),

    ('auditor', 'crm.privacy.manage')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, seed.permission_key
FROM roles role
JOIN role_permission_seed seed ON seed.role_slug = role.slug
ON CONFLICT DO NOTHING;

COMMIT;
