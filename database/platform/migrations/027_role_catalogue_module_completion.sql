BEGIN;

-- Prompt 4 (docs/implementation/ERP_AUTHORIZATION_MODEL_004.md) closes the
-- gap between packages/shared-types' ERP_MODULE_CATALOG (all 12 business
-- modules marked availability: "released") and this table's role
-- catalogue, which as of migration 018 still treated "stock",
-- "manufacturing" and "hr-payroll" as future/unassignable, and had no
-- operational role at all for "projects", "assets", "point-of-sale" and
-- "quality" (roles_module_key_check didn't even allow those module_key
-- values). This migration:
--   1. widens roles_module_key_check to the full 12-module catalogue,
--   2. corrects inventory_manager/manufacturing_manager/hr_manager to
--      assignable=true with real module permissions (they previously had
--      almost none — see apps/web/src/core/access-control.ts history), and
--   3. adds the 5 missing module-manager roles for every existing
--      organization, mirroring migration 018's own CROSS JOIN
--      organizations upsert pattern.
-- The authoritative role definitions now live in exactly one place,
-- apps/web/src/core/access-control.ts's ROLE_TEMPLATES — this migration's
-- VALUES lists are a point-in-time copy of that source needed because SQL
-- can't import TypeScript; tests/security/module-access.test.mjs asserts
-- they stay in sync.

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_module_key_check;
ALTER TABLE roles ADD CONSTRAINT roles_module_key_check CHECK (
  module_key IN (
    'platform','crm','sales','accounting','procurement',
    'stock','manufacturing','projects','assets','point-of-sale',
    'quality','support','hr-payroll'
  )
) NOT VALID;
ALTER TABLE roles VALIDATE CONSTRAINT roles_module_key_check;

WITH template(name,slug,description,module_key,risk_level,assignable) AS (
  VALUES
    ('Inventory Manager','inventory_manager','Warehouse operations, stock movements, transfers, counts, valuation and replenishment.','stock','sensitive',true),
    ('Manufacturing Manager','manufacturing_manager','BOMs, routings, work centers, material planning, work orders, production execution and costing.','manufacturing','sensitive',true),
    ('Project Manager','project_manager','Projects, milestones, tasks, resourcing, time, expenses, budgets, billing and profitability.','projects','sensitive',true),
    ('Asset Manager','asset_manager','Asset register, capitalization, custody, maintenance, depreciation, audits, transfers and disposal.','assets','sensitive',true),
    ('Point of Sale Manager','pos_manager','Stores, terminals, checkout, payments, returns, cashier shifts and reconciliation.','point-of-sale','sensitive',true),
    ('Quality Manager','quality_manager','Quality plans, inspections, holds, non-conformance, CAPA, supplier quality and audits.','quality','sensitive',true),
    ('Support Manager','support_manager','Tickets, queues, SLAs, escalation, knowledge base and customer communication.','support','sensitive',true),
    ('HR Manager','hr_manager','Employees, attendance, leave, expenses, compensation, payroll, payslips and statutory controls.','hr-payroll','sensitive',true)
)
INSERT INTO roles(organization_id,name,slug,description,is_system,module_key,template_key,assignable,risk_level)
SELECT o.id,t.name,t.slug,t.description,true,t.module_key,t.slug,t.assignable,t.risk_level
FROM organizations o CROSS JOIN template t
ON CONFLICT (organization_id,slug) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  module_key=EXCLUDED.module_key,
  template_key=EXCLUDED.template_key,
  assignable=EXCLUDED.assignable,
  risk_level=EXCLUDED.risk_level,
  is_system=true,
  status='active',
  updated_at=now();

DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id=r.id AND r.is_system=true
  AND r.template_key IN (
    'inventory_manager','manufacturing_manager','project_manager',
    'asset_manager','pos_manager','quality_manager','support_manager','hr_manager'
  );

WITH seed(role_slug,permission_key) AS (
  VALUES
    ('inventory_manager','workspace.view'),
    ('inventory_manager','notifications.view'),
    ('inventory_manager','profile.manage'),
    ('inventory_manager','business_data.view'),
    ('inventory_manager','approvals.manage'),
    ('inventory_manager','items.manage'),
    ('inventory_manager','inventory_setup.manage'),
    ('inventory_manager','stock.view'),
    ('inventory_manager','stock.manage'),
    ('inventory_manager','stock.receive'),
    ('inventory_manager','stock.issue'),
    ('inventory_manager','stock.transfer'),
    ('inventory_manager','stock.adjust'),
    ('inventory_manager','stock.reserve'),
    ('inventory_manager','stock.count'),
    ('inventory_manager','stock.valuation.view'),
    ('inventory_manager','stock.reports.view'),
    ('inventory_manager','stock.settings.manage'),
    ('inventory_manager','stock.audit.view'),

    ('manufacturing_manager','workspace.view'),
    ('manufacturing_manager','notifications.view'),
    ('manufacturing_manager','profile.manage'),
    ('manufacturing_manager','business_data.view'),
    ('manufacturing_manager','approvals.manage'),
    ('manufacturing_manager','items.manage'),
    ('manufacturing_manager','inventory_setup.manage'),
    ('manufacturing_manager','stock.view'),
    ('manufacturing_manager','stock.issue'),
    ('manufacturing_manager','stock.receive'),
    ('manufacturing_manager','stock.reserve'),
    ('manufacturing_manager','stock.valuation.view'),
    ('manufacturing_manager','manufacturing.view'),
    ('manufacturing_manager','manufacturing.manage'),
    ('manufacturing_manager','manufacturing.bom.view'),
    ('manufacturing_manager','manufacturing.bom.manage'),
    ('manufacturing_manager','manufacturing.routing.manage'),
    ('manufacturing_manager','manufacturing.planning.run'),
    ('manufacturing_manager','manufacturing.work_order.manage'),
    ('manufacturing_manager','manufacturing.work_order.release'),
    ('manufacturing_manager','manufacturing.production.post'),
    ('manufacturing_manager','manufacturing.scrap.post'),
    ('manufacturing_manager','manufacturing.costing.view'),
    ('manufacturing_manager','manufacturing.reports.view'),
    ('manufacturing_manager','manufacturing.settings.manage'),
    ('manufacturing_manager','manufacturing.audit.view'),

    ('project_manager','workspace.view'),
    ('project_manager','notifications.view'),
    ('project_manager','profile.manage'),
    ('project_manager','business_data.view'),
    ('project_manager','projects.view'),
    ('project_manager','projects.manage'),
    ('project_manager','projects.create'),
    ('project_manager','projects.tasks.manage'),
    ('project_manager','projects.milestones.manage'),
    ('project_manager','projects.resources.manage'),
    ('project_manager','projects.time.enter'),
    ('project_manager','projects.time.approve'),
    ('project_manager','projects.expense.enter'),
    ('project_manager','projects.expense.approve'),
    ('project_manager','projects.budget.manage'),
    ('project_manager','projects.procurement.link'),
    ('project_manager','projects.billing.manage'),
    ('project_manager','projects.profitability.view'),
    ('project_manager','projects.reports.view'),
    ('project_manager','projects.settings.manage'),
    ('project_manager','projects.audit.view'),

    ('asset_manager','workspace.view'),
    ('asset_manager','notifications.view'),
    ('asset_manager','profile.manage'),
    ('asset_manager','business_data.view'),
    ('asset_manager','assets.view'),
    ('asset_manager','assets.manage'),
    ('asset_manager','assets.create'),
    ('asset_manager','assets.capitalize'),
    ('asset_manager','assets.assign'),
    ('asset_manager','assets.transfer'),
    ('asset_manager','assets.maintain'),
    ('asset_manager','assets.inspect'),
    ('asset_manager','assets.depreciate'),
    ('asset_manager','assets.dispose'),
    ('asset_manager','assets.accounting.handoff'),
    ('asset_manager','assets.reports.view'),
    ('asset_manager','assets.settings.manage'),
    ('asset_manager','assets.audit.view'),

    ('pos_manager','workspace.view'),
    ('pos_manager','notifications.view'),
    ('pos_manager','profile.manage'),
    ('pos_manager','business_data.view'),
    ('pos_manager','stock.view'),
    ('pos_manager','stock.issue'),
    ('pos_manager','stock.receive'),
    ('pos_manager','pos.view'),
    ('pos_manager','pos.operate'),
    ('pos_manager','pos.shift.open'),
    ('pos_manager','pos.shift.close'),
    ('pos_manager','pos.sale.create'),
    ('pos_manager','pos.discount.apply'),
    ('pos_manager','pos.return.create'),
    ('pos_manager','pos.return.approve'),
    ('pos_manager','pos.cash.adjust'),
    ('pos_manager','pos.price.override'),
    ('pos_manager','pos.terminal.manage'),
    ('pos_manager','pos.store.manage'),
    ('pos_manager','pos.payment.manage'),
    ('pos_manager','pos.reports.view'),
    ('pos_manager','pos.settings.manage'),
    ('pos_manager','pos.audit.view'),

    ('quality_manager','workspace.view'),
    ('quality_manager','notifications.view'),
    ('quality_manager','profile.manage'),
    ('quality_manager','business_data.view'),
    ('quality_manager','stock.view'),
    ('quality_manager','procurement.view'),
    ('quality_manager','manufacturing.view'),
    ('quality_manager','pos.view'),
    ('quality_manager','quality.view'),
    ('quality_manager','quality.manage'),
    ('quality_manager','quality.plan.manage'),
    ('quality_manager','quality.inspect'),
    ('quality_manager','quality.release'),
    ('quality_manager','quality.hold'),
    ('quality_manager','quality.nonconformance.manage'),
    ('quality_manager','quality.capa.manage'),
    ('quality_manager','quality.sampling.manage'),
    ('quality_manager','quality.supplier.manage'),
    ('quality_manager','quality.audit.manage'),
    ('quality_manager','quality.reports.view'),
    ('quality_manager','quality.settings.manage'),
    ('quality_manager','quality.audit.view'),

    ('support_manager','workspace.view'),
    ('support_manager','notifications.view'),
    ('support_manager','profile.manage'),
    ('support_manager','business_data.view'),
    ('support_manager','crm.view'),
    ('support_manager','sales.view'),
    ('support_manager','projects.view'),
    ('support_manager','assets.view'),
    ('support_manager','quality.view'),
    ('support_manager','support.view'),
    ('support_manager','support.manage'),
    ('support_manager','support.ticket.create'),
    ('support_manager','support.ticket.assign'),
    ('support_manager','support.ticket.resolve'),
    ('support_manager','support.ticket.close'),
    ('support_manager','support.queue.manage'),
    ('support_manager','support.sla.manage'),
    ('support_manager','support.escalation.manage'),
    ('support_manager','support.knowledge.manage'),
    ('support_manager','support.communication.manage'),
    ('support_manager','support.sensitive.view'),
    ('support_manager','support.reports.view'),
    ('support_manager','support.settings.manage'),
    ('support_manager','support.audit.view'),

    ('hr_manager','workspace.view'),
    ('hr_manager','notifications.view'),
    ('hr_manager','profile.manage'),
    ('hr_manager','business_data.view'),
    ('hr_manager','hr_payroll.view'),
    ('hr_manager','hr_payroll.employee.view'),
    ('hr_manager','hr_payroll.employee.manage'),
    ('hr_manager','hr_payroll.sensitive.view'),
    ('hr_manager','hr_payroll.attendance.manage'),
    ('hr_manager','hr_payroll.shift.manage'),
    ('hr_manager','hr_payroll.leave.manage'),
    ('hr_manager','hr_payroll.leave.approve'),
    ('hr_manager','hr_payroll.expense.manage'),
    ('hr_manager','hr_payroll.expense.approve'),
    ('hr_manager','hr_payroll.payroll.prepare'),
    ('hr_manager','hr_payroll.payroll.approve'),
    ('hr_manager','hr_payroll.payroll.post'),
    ('hr_manager','hr_payroll.payslip.view'),
    ('hr_manager','hr_payroll.compensation.manage'),
    ('hr_manager','hr_payroll.statutory.manage'),
    ('hr_manager','hr_payroll.reports.view'),
    ('hr_manager','hr_payroll.settings.manage'),
    ('hr_manager','hr_payroll.audit.view')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, s.permission_key
FROM seed s
JOIN roles r ON r.slug = s.role_slug AND r.is_system = true
WHERE r.template_key = s.role_slug
ON CONFLICT DO NOTHING;

COMMIT;
