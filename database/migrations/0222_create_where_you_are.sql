-- Create-Where-You-Are: removing dead ends across the ERP (Phase 3).
-- 1. A system item per company, "Unlisted item": a line that is just a description, quantity, price, HSN/SAC and GST (a deal product,
--    a quotation, an order or a POS sale) points at it, so no line column becomes optional; the line keeps its own name and tax.
--    Catalogue lists, pickers and reports leave it out by its system role.
-- 2. Sales › Settings: whether such lines are allowed (on by default).
-- 3. Point of Sale: billing an item not in the catalogue (an open item), a permission of its own.
-- 4. Procurement: receiving goods that arrived without an order — the receipt raises the order (marked) in the same step, when the
--    company allows it; on by default, except where purchase orders already go through approval rules.
-- Additive and re-runnable.

-- 1. The system item's role.
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS system_role text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_system_role_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_system_role_check CHECK (system_role IS NULL OR system_role IN ('unlisted'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS items_system_role_uidx ON tenant.items (organization_id, system_role) WHERE system_role IS NOT NULL;

-- 2. Sales: lines without a catalogue item.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS allow_lines_without_item boolean NOT NULL DEFAULT true;

-- 3. POS: the open item.
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('pos.open_item', 'Bill items not in the catalogue', 'Point of Sale', 'Add a line with a typed name, price and GST rate for something not yet in the catalogue.')
ON CONFLICT (key) DO NOTHING;
-- Whoever may override a price or approve discounts at the counter may bill an open item.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'pos.open_item' FROM public.role_permissions existing
 WHERE existing.permission_key IN ('pos.price.override', 'pos.discount.approve', 'pos.settings.manage')
ON CONFLICT DO NOTHING;
-- The GST category an open item was billed under (a catalogue line's comes from its item).
ALTER TABLE tenant.pos_cart_lines ADD COLUMN IF NOT EXISTS tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE SET NULL;

-- 4. Procurement: receive without an order.
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS allow_receipt_without_order boolean;
UPDATE tenant.procurement_settings settings
   SET allow_receipt_without_order = NOT EXISTS (
         SELECT 1 FROM public.approval_rules rule WHERE rule.organization_id = settings.organization_id AND rule.document_type = 'procurement.purchase_order' AND rule.active)
 WHERE settings.allow_receipt_without_order IS NULL;
ALTER TABLE tenant.procurement_settings ALTER COLUMN allow_receipt_without_order SET DEFAULT true;
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS created_from_receipt boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS created_from_receipt_reason text;
