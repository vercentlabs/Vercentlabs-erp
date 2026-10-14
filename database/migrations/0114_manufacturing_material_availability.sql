-- Manufacturing: Material Availability. A derived calculation over the frozen manufacturing-order materials and Inventory's own stock,
-- reservations, eligibility and availability versions — no manufacturing stock ledger and no stored available quantity. This migration adds
-- only what the calculation and its actions need: permissions, the reservation and release policy, and an exact material-line reference on
-- the shortage demand handed to Procurement. Additive only.

-- ============================================================ 1. policy
-- Whether a planner may reserve part of what an order needs (with explicit confirmation), and whether an order may be released while
-- materials are short (it can never issue stock it does not have either way).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_partial_reservation_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_release_with_shortages_allowed boolean NOT NULL DEFAULT true;

-- ============================================================ 2. shortage demand references the exact order material line
ALTER TABLE tenant.manufacturing_material_demands ADD COLUMN IF NOT EXISTS manufacturing_order_material_id uuid REFERENCES tenant.manufacturing_order_materials(id);
CREATE INDEX IF NOT EXISTS manufacturing_material_demands_order_line_idx ON tenant.manufacturing_material_demands (organization_id, manufacturing_order_material_id) WHERE manufacturing_order_material_id IS NOT NULL;

-- ============================================================ 3. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.material.view', 'View material availability', 'Manufacturing', 'See material requirements, coverage, shortages and feasible output.'),
  ('manufacturing.material.view_other_warehouse', 'View other warehouses', 'Manufacturing', 'See usable stock of order materials in other warehouses.'),
  ('manufacturing.material.shortage_request', 'Request missing materials', 'Manufacturing', 'Hand material shortages to Procurement as demand.'),
  ('manufacturing.material.export', 'Export material availability', 'Manufacturing', 'Export material availability and shortage reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.material.view'), ('manufacturing_manager', 'manufacturing.material.view_other_warehouse'),
    ('manufacturing_manager', 'manufacturing.material.shortage_request'), ('manufacturing_manager', 'manufacturing.material.export'),
    ('production_planner', 'manufacturing.material.view'), ('production_planner', 'manufacturing.material.view_other_warehouse'),
    ('production_planner', 'manufacturing.material.shortage_request'), ('production_planner', 'manufacturing.material.export'),
    ('inventory_manager', 'manufacturing.material.view'), ('inventory_manager', 'manufacturing.material.view_other_warehouse'),
    ('shop_floor_operator', 'manufacturing.material.view'),
    ('purchase_manager', 'manufacturing.view'), ('purchase_manager', 'manufacturing.material.view'), ('purchase_manager', 'manufacturing.mo.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0114_manufacturing_material_availability.sql', 'manufacturing-material-availability') ON CONFLICT DO NOTHING;
