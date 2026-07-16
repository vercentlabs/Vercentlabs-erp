BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.view', 'View CRM', 'CRM', 'View CRM dashboards, leads, opportunities, activities and reports.'),
  ('crm.leads.manage', 'Manage CRM leads', 'CRM', 'Create, assign, qualify, merge, import and convert leads.'),
  ('crm.opportunities.manage', 'Manage opportunities', 'CRM', 'Create and progress opportunities through governed pipelines.'),
  ('crm.activities.manage', 'Manage CRM activities', 'CRM', 'Schedule and complete calls, tasks, meetings, messages and follow-ups.'),
  ('crm.campaigns.manage', 'Manage CRM campaigns', 'CRM', 'Create campaigns and maintain campaign membership and attribution.'),
  ('crm.communications.manage', 'Manage CRM communications', 'CRM', 'Record omnichannel customer communications and provider-neutral outbox events.'),
  ('crm.automation.manage', 'Manage CRM automation', 'CRM', 'Configure assignment, scoring, sequences and deterministic automation rules.'),
  ('crm.capture.manage', 'Manage lead capture', 'CRM', 'Configure public lead-capture forms, origins, routing and rate limits.'),
  ('crm.import', 'Import CRM data', 'CRM', 'Run governed CRM imports and review row outcomes.'),
  ('crm.export', 'Export CRM data', 'CRM', 'Export permitted CRM records.'),
  ('crm.reports.view', 'View CRM reports', 'CRM', 'View pipeline, conversion, activity, campaign and forecast reports.'),
  ('crm.settings.manage', 'Manage CRM settings', 'CRM', 'Configure pipelines, stages, sources, tags, loss reasons, targets and saved views.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description;

WITH role_permission_seed(role_slug, permission_key) AS (
  VALUES
    ('organization_owner', 'crm.view'),
    ('organization_owner', 'crm.leads.manage'),
    ('organization_owner', 'crm.opportunities.manage'),
    ('organization_owner', 'crm.activities.manage'),
    ('organization_owner', 'crm.campaigns.manage'),
    ('organization_owner', 'crm.communications.manage'),
    ('organization_owner', 'crm.automation.manage'),
    ('organization_owner', 'crm.capture.manage'),
    ('organization_owner', 'crm.import'),
    ('organization_owner', 'crm.export'),
    ('organization_owner', 'crm.reports.view'),
    ('organization_owner', 'crm.settings.manage'),

    ('system_administrator', 'crm.view'),
    ('system_administrator', 'crm.leads.manage'),
    ('system_administrator', 'crm.opportunities.manage'),
    ('system_administrator', 'crm.activities.manage'),
    ('system_administrator', 'crm.campaigns.manage'),
    ('system_administrator', 'crm.communications.manage'),
    ('system_administrator', 'crm.automation.manage'),
    ('system_administrator', 'crm.capture.manage'),
    ('system_administrator', 'crm.import'),
    ('system_administrator', 'crm.export'),
    ('system_administrator', 'crm.reports.view'),
    ('system_administrator', 'crm.settings.manage'),

    ('company_administrator', 'crm.view'),
    ('company_administrator', 'crm.leads.manage'),
    ('company_administrator', 'crm.opportunities.manage'),
    ('company_administrator', 'crm.activities.manage'),
    ('company_administrator', 'crm.campaigns.manage'),
    ('company_administrator', 'crm.communications.manage'),
    ('company_administrator', 'crm.automation.manage'),
    ('company_administrator', 'crm.capture.manage'),
    ('company_administrator', 'crm.import'),
    ('company_administrator', 'crm.export'),
    ('company_administrator', 'crm.reports.view'),
    ('company_administrator', 'crm.settings.manage'),

    ('sales_manager', 'crm.view'),
    ('sales_manager', 'crm.leads.manage'),
    ('sales_manager', 'crm.opportunities.manage'),
    ('sales_manager', 'crm.activities.manage'),
    ('sales_manager', 'crm.campaigns.manage'),
    ('sales_manager', 'crm.communications.manage'),
    ('sales_manager', 'crm.automation.manage'),
    ('sales_manager', 'crm.capture.manage'),
    ('sales_manager', 'crm.import'),
    ('sales_manager', 'crm.export'),
    ('sales_manager', 'crm.reports.view'),
    ('sales_manager', 'crm.settings.manage'),

    ('employee', 'crm.view'),
    ('employee', 'crm.leads.manage'),
    ('employee', 'crm.opportunities.manage'),
    ('employee', 'crm.activities.manage'),
    ('employee', 'crm.communications.manage'),
    ('employee', 'crm.export'),
    ('employee', 'crm.reports.view'),

    ('auditor', 'crm.view'),
    ('auditor', 'crm.export'),
    ('auditor', 'crm.reports.view'),

    ('read_only', 'crm.view'),
    ('read_only', 'crm.reports.view')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, seed.permission_key
FROM roles r
JOIN role_permission_seed seed ON seed.role_slug = r.slug
ON CONFLICT DO NOTHING;

WITH series_seed(entity_type, prefix) AS (
  VALUES
    ('crm_lead', 'LEAD-'),
    ('crm_opportunity', 'OPP-'),
    ('crm_campaign', 'CMP-'),
    ('crm_activity', 'ACT-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT o.id, seed.entity_type, seed.prefix
FROM organizations o
CROSS JOIN series_seed seed
ON CONFLICT (organization_id, entity_type) DO NOTHING;

COMMIT;
