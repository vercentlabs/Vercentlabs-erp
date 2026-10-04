-- Products and Services.
--
-- A product or service is one tenant.items row, shared by Sales, CRM,
-- Procurement, Inventory, Manufacturing and POS. This migration adds what the
-- Product master needs on that shared record:
--
-- 1. Product fields: sales and purchase descriptions, SKU, sales and
--    purchase units, sellable / purchasable flags and an optional image.
--    The type is derived: Service (item_type service), Stock Item (inventory
--    tracked) or Non-Stock Item (anything else).
-- 2. Rules: a service never tracks inventory; a SKU is unique per tenant.
-- 3. Product history: the audit trail of master-data changes.
-- 4. Permissions for the Product master, granted to the roles that maintain
--    or use items today.

-- ============================================================ 1. product fields

ALTER TABLE tenant.items
  ADD COLUMN IF NOT EXISTS sales_description text,
  ADD COLUMN IF NOT EXISTS purchase_description text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS sales_uom_id uuid,
  ADD COLUMN IF NOT EXISTS purchase_uom_id uuid,
  ADD COLUMN IF NOT EXISTS is_sellable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_purchasable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS image_attachment_id uuid;

ALTER TABLE tenant.items
  ADD CONSTRAINT items_sales_uom_organization_fkey FOREIGN KEY (organization_id, sales_uom_id)
    REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT items_purchase_uom_organization_fkey FOREIGN KEY (organization_id, purchase_uom_id)
    REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT;

-- Existing services that were marked as tracked, but never moved stock, stop tracking.
UPDATE tenant.items item SET track_inventory = false
 WHERE item.item_type = 'service' AND item.track_inventory
   AND NOT EXISTS (SELECT 1 FROM tenant.stock_movements movement WHERE movement.organization_id = item.organization_id AND movement.item_id = item.id);

-- ============================================================ 2. rules

-- A service never tracks inventory, however it is written: the column
-- defaults to tracked, and older code that inserts a service without saying
-- otherwise must not create a stock-tracked service. An old service that
-- already moved stock keeps its flag until it is next changed.
CREATE OR REPLACE FUNCTION tenant.items_service_never_tracked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_type = 'service' THEN
    NEW.track_inventory := false;
    NEW.tracking_type := 'none';
    NEW.sku := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_service_never_tracked BEFORE INSERT OR UPDATE OF item_type, track_inventory, tracking_type, sku ON tenant.items
  FOR EACH ROW EXECUTE FUNCTION tenant.items_service_never_tracked();

CREATE UNIQUE INDEX IF NOT EXISTS items_sku_uidx ON tenant.items (organization_id, upper(sku)) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX IF NOT EXISTS items_sellable_idx ON tenant.items (organization_id, lower(name)) WHERE status = 'active' AND is_sellable;

-- ============================================================ 3. product history

CREATE TABLE IF NOT EXISTS tenant.product_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'activated', 'deactivated', 'imported')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_history_item_idx ON tenant.product_history (organization_id, item_id, created_at DESC);

ALTER TABLE tenant.product_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.product_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.product_history
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.product_history TO vercent_app;
GRANT SELECT ON tenant.product_history TO vercent_worker;

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('products.view', 'View products and services', 'Products', 'Open the product and service catalogue.'),
  ('products.create', 'Create products and services', 'Products', 'Add a product or service to the catalogue.'),
  ('products.edit', 'Edit products and services', 'Products', 'Change a product''s name, descriptions, category and units.'),
  ('products.activate', 'Activate and deactivate products', 'Products', 'Make a product or service active or inactive.'),
  ('products.delete', 'Delete unused products', 'Products', 'Permanently delete a product or service that has never been used.'),
  ('products.import', 'Import products and services', 'Products', 'Import products and services from a CSV or Excel file.'),
  ('products.export', 'Export products and services', 'Products', 'Export the product and service list.'),
  ('products.edit_pricing', 'Edit default sales prices', 'Products', 'Change a product''s default sales price.'),
  ('products.edit_tax', 'Edit product tax classification', 'Products', 'Change a product''s HSN / SAC and tax category.'),
  ('products.edit_inventory', 'Edit inventory configuration', 'Products', 'Change a product''s type, inventory tracking, base unit, SKU and barcode.'),
  ('products.view_cost', 'View product costs', 'Products', 'See purchase cost and inventory cost on products.'),
  ('products.edit_cost', 'Edit product costs', 'Products', 'Change a product''s default purchase cost and standard cost.')
ON CONFLICT (key) DO NOTHING;

-- Whoever can open Sales, Procurement or Inventory, or browse business data, sees the catalogue.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'products.view'
  FROM public.role_permissions existing
 WHERE existing.permission_key IN ('sales.view', 'procurement.view', 'stock.view', 'business_data.view', 'items.manage')
ON CONFLICT DO NOTHING;

-- Whoever maintains items, or administers Sales, maintains products.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'products.create', 'products.edit', 'products.activate', 'products.delete', 'products.import', 'products.export', 'products.edit_pricing',
    'products.edit_tax', 'products.edit_inventory'])
 WHERE existing.permission_key IN ('items.manage', 'sales.settings.manage')
ON CONFLICT DO NOTHING;

-- Cost is margin and valuation information.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'products.view_cost'
  FROM public.role_permissions existing
 WHERE existing.permission_key IN ('sales.margin.view', 'stock.valuation.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT cost.role_id, 'products.edit_cost'
  FROM public.role_permissions cost
  JOIN public.role_permissions manage ON manage.role_id = cost.role_id AND manage.permission_key = 'items.manage'
 WHERE cost.permission_key = 'products.view_cost'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0024_products_services.sql', 'products-services');
