BEGIN;
INSERT INTO permissions(key,name,category,description) VALUES
  ('procurement.view','View','Procurement','Enterprise Procurement permission.'),
  ('procurement.settings.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.suppliers.view','View','Procurement','Enterprise Procurement permission.'),
  ('procurement.suppliers.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.suppliers.qualify','Qualify','Procurement','Enterprise Procurement permission.'),
  ('procurement.suppliers.sensitive','Sensitive','Procurement','Enterprise Procurement permission.'),
  ('procurement.catalog.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.requisition.create','Create','Procurement','Enterprise Procurement permission.'),
  ('procurement.requisition.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.requisition.approve','Approve','Procurement','Enterprise Procurement permission.'),
  ('procurement.sourcing.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.sourcing.evaluate','Evaluate','Procurement','Enterprise Procurement permission.'),
  ('procurement.sourcing.award','Award','Procurement','Enterprise Procurement permission.'),
  ('procurement.contracts.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.contracts.approve','Approve','Procurement','Enterprise Procurement permission.'),
  ('procurement.po.create','Create','Procurement','Enterprise Procurement permission.'),
  ('procurement.po.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.po.approve','Approve','Procurement','Enterprise Procurement permission.'),
  ('procurement.po.dispatch','Dispatch','Procurement','Enterprise Procurement permission.'),
  ('procurement.po.amend','Amend','Procurement','Enterprise Procurement permission.'),
  ('procurement.po.cancel','Cancel','Procurement','Enterprise Procurement permission.'),
  ('procurement.receipts.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.receipts.approve','Approve','Procurement','Enterprise Procurement permission.'),
  ('procurement.inspection.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.returns.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.matching.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.matching.override','Override','Procurement','Enterprise Procurement permission.'),
  ('procurement.supplier_portal.manage','Manage','Procurement','Enterprise Procurement permission.'),
  ('procurement.reports.view','View','Procurement','Enterprise Procurement permission.'),
  ('procurement.audit.view','View','Procurement','Enterprise Procurement permission.')
ON CONFLICT(key) DO UPDATE SET name=excluded.name,category=excluded.category,description=excluded.description;
WITH seed(role_slug,permission_key) AS (VALUES ('organization_owner','procurement.view'),('organization_owner','procurement.settings.manage'),('organization_owner','procurement.suppliers.view'),('organization_owner','procurement.suppliers.manage'),('organization_owner','procurement.suppliers.qualify'),('organization_owner','procurement.suppliers.sensitive'),('organization_owner','procurement.catalog.manage'),('organization_owner','procurement.requisition.create'),('organization_owner','procurement.requisition.manage'),('organization_owner','procurement.requisition.approve'),('organization_owner','procurement.sourcing.manage'),('organization_owner','procurement.sourcing.evaluate'),('organization_owner','procurement.sourcing.award'),('organization_owner','procurement.contracts.manage'),('organization_owner','procurement.contracts.approve'),('organization_owner','procurement.po.create'),('organization_owner','procurement.po.manage'),('organization_owner','procurement.po.approve'),('organization_owner','procurement.po.dispatch'),('organization_owner','procurement.po.amend'),('organization_owner','procurement.po.cancel'),('organization_owner','procurement.receipts.manage'),('organization_owner','procurement.receipts.approve'),('organization_owner','procurement.inspection.manage'),('organization_owner','procurement.returns.manage'),('organization_owner','procurement.matching.manage'),('organization_owner','procurement.matching.override'),('organization_owner','procurement.supplier_portal.manage'),('organization_owner','procurement.reports.view'),('organization_owner','procurement.audit.view'),('system_administrator','procurement.view'),('system_administrator','procurement.settings.manage'),('system_administrator','procurement.suppliers.view'),('system_administrator','procurement.suppliers.manage'),('system_administrator','procurement.suppliers.qualify'),('system_administrator','procurement.suppliers.sensitive'),('system_administrator','procurement.catalog.manage'),('system_administrator','procurement.requisition.create'),('system_administrator','procurement.requisition.manage'),('system_administrator','procurement.requisition.approve'),('system_administrator','procurement.sourcing.manage'),('system_administrator','procurement.sourcing.evaluate'),('system_administrator','procurement.sourcing.award'),('system_administrator','procurement.contracts.manage'),('system_administrator','procurement.contracts.approve'),('system_administrator','procurement.po.create'),('system_administrator','procurement.po.manage'),('system_administrator','procurement.po.approve'),('system_administrator','procurement.po.dispatch'),('system_administrator','procurement.po.amend'),('system_administrator','procurement.po.cancel'),('system_administrator','procurement.receipts.manage'),('system_administrator','procurement.receipts.approve'),('system_administrator','procurement.inspection.manage'),('system_administrator','procurement.returns.manage'),('system_administrator','procurement.matching.manage'),('system_administrator','procurement.matching.override'),('system_administrator','procurement.supplier_portal.manage'),('system_administrator','procurement.reports.view'),('system_administrator','procurement.audit.view'),('company_administrator','procurement.view'),('company_administrator','procurement.settings.manage'),('company_administrator','procurement.suppliers.view'),('company_administrator','procurement.suppliers.manage'),('company_administrator','procurement.suppliers.qualify'),('company_administrator','procurement.suppliers.sensitive'),('company_administrator','procurement.catalog.manage'),('company_administrator','procurement.requisition.create'),('company_administrator','procurement.requisition.manage'),('company_administrator','procurement.requisition.approve'),('company_administrator','procurement.sourcing.manage'),('company_administrator','procurement.sourcing.evaluate'),('company_administrator','procurement.sourcing.award'),('company_administrator','procurement.contracts.manage'),('company_administrator','procurement.contracts.approve'),('company_administrator','procurement.po.create'),('company_administrator','procurement.po.manage'),('company_administrator','procurement.po.approve'),('company_administrator','procurement.po.dispatch'),('company_administrator','procurement.po.amend'),('company_administrator','procurement.po.cancel'),('company_administrator','procurement.receipts.manage'),('company_administrator','procurement.receipts.approve'),('company_administrator','procurement.inspection.manage'),('company_administrator','procurement.returns.manage'),('company_administrator','procurement.matching.manage'),('company_administrator','procurement.matching.override'),('company_administrator','procurement.supplier_portal.manage'),('company_administrator','procurement.reports.view'),('company_administrator','procurement.audit.view'),('purchase_manager','procurement.view'),('purchase_manager','procurement.settings.manage'),('purchase_manager','procurement.suppliers.view'),('purchase_manager','procurement.suppliers.manage'),('purchase_manager','procurement.suppliers.qualify'),('purchase_manager','procurement.suppliers.sensitive'),('purchase_manager','procurement.catalog.manage'),('purchase_manager','procurement.requisition.create'),('purchase_manager','procurement.requisition.manage'),('purchase_manager','procurement.requisition.approve'),('purchase_manager','procurement.sourcing.manage'),('purchase_manager','procurement.sourcing.evaluate'),('purchase_manager','procurement.sourcing.award'),('purchase_manager','procurement.contracts.manage'),('purchase_manager','procurement.contracts.approve'),('purchase_manager','procurement.po.create'),('purchase_manager','procurement.po.manage'),('purchase_manager','procurement.po.approve'),('purchase_manager','procurement.po.dispatch'),('purchase_manager','procurement.po.amend'),('purchase_manager','procurement.po.cancel'),('purchase_manager','procurement.receipts.manage'),('purchase_manager','procurement.receipts.approve'),('purchase_manager','procurement.inspection.manage'),('purchase_manager','procurement.returns.manage'),('purchase_manager','procurement.matching.manage'),('purchase_manager','procurement.matching.override'),('purchase_manager','procurement.supplier_portal.manage'),('purchase_manager','procurement.reports.view'),('purchase_manager','procurement.audit.view'),('employee','procurement.view'),('employee','procurement.suppliers.view'),('employee','procurement.requisition.create'),('employee','procurement.reports.view'),('auditor','procurement.view'),('auditor','procurement.suppliers.view'),('auditor','procurement.reports.view'),('auditor','procurement.audit.view'))
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,s.permission_key FROM roles r JOIN seed s ON s.role_slug=r.slug JOIN permissions p ON p.key=s.permission_key
ON CONFLICT DO NOTHING;
INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at)
SELECT organization.id, 'procurement', 'Procurement', 'enabled', now()
FROM organizations organization
ON CONFLICT (organization_id, module_key) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'enabled',
  enabled_at = COALESCE(organization_modules.enabled_at, now()),
  updated_at = now();

WITH series_seed(entity_type, prefix) AS (
  VALUES
    ('purchase_requisition','PR-'),
    ('sourcing_event','RFQ-'),
    ('procurement_agreement','PA-'),
    ('purchase_order','PO-'),
    ('advance_shipping_notice','ASN-'),
    ('goods_receipt','GRN-'),
    ('service_entry','SES-'),
    ('return_to_vendor','RTV-'),
    ('procurement_match_exception','PME-')
)
INSERT INTO numbering_series (organization_id, entity_type, prefix)
SELECT organization.id, seed.entity_type, seed.prefix
FROM organizations organization
CROSS JOIN series_seed seed
ON CONFLICT (organization_id, entity_type) DO NOTHING;

UPDATE billing_plans
SET modules = (
      SELECT jsonb_agg(module_key ORDER BY module_key)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(COALESCE(billing_plans.modules, '[]'::jsonb)) AS module_key
        UNION ALL SELECT 'accounting'
        UNION ALL SELECT 'crm'
        UNION ALL SELECT 'procurement'
        UNION ALL SELECT 'sales'
      ) modules
    ),
    features = CASE
      WHEN features @> '["Governed source-to-pay"]'::jsonb THEN features
      ELSE COALESCE(features, '[]'::jsonb) || '["Governed source-to-pay"]'::jsonb
    END,
    updated_at = now()
WHERE status = 'active';

UPDATE organization_subscriptions
SET modules_snapshot = (
      SELECT jsonb_agg(module_key ORDER BY module_key)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(COALESCE(organization_subscriptions.modules_snapshot, '[]'::jsonb)) AS module_key
        UNION ALL SELECT 'accounting'
        UNION ALL SELECT 'crm'
        UNION ALL SELECT 'procurement'
        UNION ALL SELECT 'sales'
      ) modules
    ),
    updated_at = now();
COMMIT;
