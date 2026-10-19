-- Roles & Permissions MVP (Shared Platform). One role catalogue, enforced from the database:
--
-- 1. Role names are unique within a company (among active roles), whatever their letter case: two "Sales Executive" roles
--    would be impossible to tell apart when assigning people.
-- 2. The Organisation Owner and the System Administrator hold every permission in the catalogue (a key a later module added was
--    missing for companies created after it).
-- 3. Three functional templates every company gets (packages/permissions roles.js keeps the same lists): Warehouse Operator,
--    Production Supervisor and Asset Custodian. Built-in, so they are copied rather than edited.
CREATE UNIQUE INDEX IF NOT EXISTS roles_active_name_uidx ON public.roles (organization_id, lower(name)) WHERE status = 'active';

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key FROM public.roles role CROSS JOIN public.permissions permission
 WHERE role.slug IN ('organization_owner', 'system_administrator')
ON CONFLICT DO NOTHING;

INSERT INTO public.roles (id, organization_id, name, slug, description, is_system, status, module_key, template_key, assignable, risk_level, version)
SELECT gen_random_uuid(), organization.id, template.name, template.slug, template.description, true, 'active', template.module_key, template.slug, true, template.risk, 1
  FROM public.organizations organization
  CROSS JOIN (VALUES
    ('Warehouse Operator', 'warehouse_operator', 'Receives, issues, moves and counts stock in the warehouse. Cannot post adjustments, reverse movements or see stock value.', 'stock', 'standard'),
    ('Production Supervisor', 'production_supervisor', 'Runs the shop floor: issues and returns material, records and receives production, and approves scrap reported by operators.', 'manufacturing', 'standard'),
    ('Asset Custodian', 'asset_custodian', 'Looks after the assets in their care: acknowledges, reports, requests maintenance and returns them. No asset values or depreciation.', 'assets', 'standard')
  ) AS template(name, slug, description, module_key, risk)
 WHERE EXISTS (SELECT 1 FROM public.roles existing WHERE existing.organization_id = organization.id AND existing.slug = 'organization_owner')
   AND NOT EXISTS (SELECT 1 FROM public.roles named WHERE named.organization_id = organization.id AND named.status = 'active' AND lower(named.name) = lower(template.name))
ON CONFLICT (organization_id, slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('warehouse_operator', 'workspace.view'),
    ('warehouse_operator', 'notifications.view'),
    ('warehouse_operator', 'profile.manage'),
    ('warehouse_operator', 'business_data.view'),
    ('warehouse_operator', 'stock.view'),
    ('warehouse_operator', 'stock.receive'),
    ('warehouse_operator', 'stock.issue'),
    ('warehouse_operator', 'stock.transfer'),
    ('warehouse_operator', 'stock.reserve'),
    ('warehouse_operator', 'stock.transfers.view'),
    ('warehouse_operator', 'stock.transfers.create'),
    ('warehouse_operator', 'stock.transfers.dispatch'),
    ('warehouse_operator', 'stock.transfers.receive'),
    ('warehouse_operator', 'stock.goods_issue.view'),
    ('warehouse_operator', 'stock.goods_issue.create'),
    ('warehouse_operator', 'stock.counts.view'),
    ('warehouse_operator', 'stock.counts.start'),
    ('warehouse_operator', 'stock.counts.count'),
    ('warehouse_operator', 'stock.counts.count_batch'),
    ('warehouse_operator', 'stock.counts.count_serial'),
    ('warehouse_operator', 'stock.counts.add_unexpected'),
    ('warehouse_operator', 'stock.counts.submit'),
    ('warehouse_operator', 'stock.adjustments.view'),
    ('warehouse_operator', 'stock.adjustments.create'),
    ('warehouse_operator', 'stock.reservations.view'),
    ('warehouse_operator', 'stock.holds.view'),
    ('warehouse_operator', 'stock.ledger.view'),
    ('warehouse_operator', 'stock.alerts.view'),
    ('warehouse_operator', 'stock.alerts.acknowledge'),
    ('warehouse_operator', 'stock.reorder.view'),
    ('warehouse_operator', 'products.view'),
    ('warehouse_operator', 'products.view_sku_history'),
    ('warehouse_operator', 'products.view_stock'),
    ('warehouse_operator', 'tax.view'),
    ('warehouse_operator', 'sales.reservation.view_all'),
    ('warehouse_operator', 'sales.delivery.view'),
    ('warehouse_operator', 'sales.delivery.print'),
    ('warehouse_operator', 'sales.delivery.view_all'),
    ('warehouse_operator', 'sales.delivery.edit'),
    ('warehouse_operator', 'sales.delivery.deliver'),
    ('warehouse_operator', 'sales.delivery.cancel'),
    ('warehouse_operator', 'sales.delivery.dispatch'),
    ('warehouse_operator', 'sales.return.view'),
    ('warehouse_operator', 'sales.return.print'),
    ('warehouse_operator', 'sales.return.view_all'),
    ('warehouse_operator', 'sales.return.create'),
    ('warehouse_operator', 'sales.return.edit'),
    ('warehouse_operator', 'sales.return.receive'),
    ('warehouse_operator', 'sales.return.select_warehouse'),
    ('warehouse_operator', 'warehouses.view'),
    ('warehouse_operator', 'warehouses.view_stock'),
    ('warehouse_operator', 'stock.opening.view'),
    ('warehouse_operator', 'stock.reservations.view_sources'),
    ('warehouse_operator', 'stock.reservations.view_allocations'),
    ('warehouse_operator', 'stock.counts.view_history'),
    ('warehouse_operator', 'stock.holds.view_history'),
    ('warehouse_operator', 'stock.alerts.view_history'),
    ('warehouse_operator', 'stock.reorder.view_requirements'),
    ('warehouse_operator', 'stock.reorder.view_demand'),
    ('warehouse_operator', 'stock.reorder.view_incoming'),
    ('warehouse_operator', 'stock.reorder.view_other_stock'),
    ('warehouse_operator', 'stock.reorder.create_transfer_draft'),
    ('warehouse_operator', 'stock.negative.view_warnings'),
    ('warehouse_operator', 'stock.goods_issue.post'),
    ('warehouse_operator', 'stock.transfers.confirm'),
    ('production_supervisor', 'workspace.view'),
    ('production_supervisor', 'notifications.view'),
    ('production_supervisor', 'profile.manage'),
    ('production_supervisor', 'business_data.view'),
    ('production_supervisor', 'manufacturing.view'),
    ('production_supervisor', 'manufacturing.mo.view'),
    ('production_supervisor', 'manufacturing.mo.start'),
    ('production_supervisor', 'manufacturing.mo.record_production'),
    ('production_supervisor', 'manufacturing.mo.reserve_material'),
    ('production_supervisor', 'manufacturing.mo.issue_material'),
    ('production_supervisor', 'manufacturing.mo.return_material'),
    ('production_supervisor', 'manufacturing.mo.receive_goods'),
    ('production_supervisor', 'manufacturing.material.view'),
    ('production_supervisor', 'manufacturing.issue.view'),
    ('production_supervisor', 'manufacturing.consumption.view'),
    ('production_supervisor', 'manufacturing.consumption.create'),
    ('production_supervisor', 'manufacturing.consumption.post'),
    ('production_supervisor', 'manufacturing.production.edit_draft'),
    ('production_supervisor', 'manufacturing.production.post'),
    ('production_supervisor', 'manufacturing.production.export'),
    ('production_supervisor', 'manufacturing.fgr.view'),
    ('production_supervisor', 'manufacturing.fgr.create'),
    ('production_supervisor', 'manufacturing.fgr.edit_draft'),
    ('production_supervisor', 'manufacturing.fgr.post'),
    ('production_supervisor', 'manufacturing.scrap.view'),
    ('production_supervisor', 'manufacturing.scrap.approve'),
    ('production_supervisor', 'manufacturing.variance.view'),
    ('production_supervisor', 'manufacturing.hold.view'),
    ('production_supervisor', 'manufacturing.qi.view'),
    ('production_supervisor', 'products.view'),
    ('production_supervisor', 'products.view_sku_history'),
    ('production_supervisor', 'tax.view'),
    ('asset_custodian', 'workspace.view'),
    ('asset_custodian', 'notifications.view'),
    ('asset_custodian', 'profile.manage'),
    ('asset_custodian', 'business_data.view'),
    ('asset_custodian', 'assets.view'),
    ('asset_custodian', 'assets.custody.acknowledge'),
    ('asset_custodian', 'assets.custody.dispute'),
    ('asset_custodian', 'assets.custody.return'),
    ('asset_custodian', 'assets.assignment.view'),
    ('asset_custodian', 'assets.assignment.request'),
    ('asset_custodian', 'assets.assignment.return'),
    ('asset_custodian', 'assets.status.report_missing'),
    ('asset_custodian', 'assets.status.condition_update'),
    ('asset_custodian', 'assets.location.record_observation'),
    ('asset_custodian', 'assets.maintenance.view'),
    ('asset_custodian', 'assets.maintenance.request'),
    ('asset_custodian', 'assets.movement.view'),
    ('asset_custodian', 'assets.transfer.view'),
    ('asset_custodian', 'assets.transfer.report_exception'),
    ('asset_custodian', 'products.view'),
    ('asset_custodian', 'products.view_sku_history'),
    ('asset_custodian', 'tax.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug AND role.is_system
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0194_roles_permissions_mvp.sql', 'roles-permissions-mvp') ON CONFLICT DO NOTHING;
