-- 0084 Product Search (POS): find a product by name, SKU, barcode or category and add it to the sale in seconds. Products stay the shared
-- Item Master's (identity, SKU, barcodes, categories, variants, units); prices come from the shared price lists, stock from Inventory's
-- availability. POS owns only how an outlet shows its products and which products it keeps one tap away.
--
-- 1. Outlet product settings: which products the outlet sells (every sellable product, or the products of chosen categories), whether
--    stock status and exact quantities are shown, the low-stock threshold and whether frequently sold products fill the quick tiles. The
--    outlet's fulfilment warehouse stays pos_stores.warehouse_id (Stores & Outlets).
-- 2. Quick products: an outlet's shortlist (a product and optionally the unit it is sold in), in order. Never a copy of the product.
-- 3. A cart or sale line remembers the unit it was sold in, the conversion factor and the quantity in the base unit (stock moves in the
--    base unit; a box of 12 issues 12 pieces).
-- 4. Request keys: a retried or double-fired "add" (a scanner sending one event twice, a client retry) changes the cart once.
-- 5. Search indexes on the canonical item records (trigram and prefix), so search is never stale: there is no copy to fall behind.
-- 6. Diagnostic events: barcode misses, ambiguous barcodes, search errors and slow searches, with no customer or personal details.

-- ============================================================ 1. outlet product settings

CREATE TABLE IF NOT EXISTS tenant.pos_outlet_product_settings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  assortment_policy text NOT NULL DEFAULT 'all_sellable' CHECK (assortment_policy IN ('all_sellable', 'selected_categories')),
  show_stock_status boolean NOT NULL DEFAULT true,
  show_exact_stock_if_authorized boolean NOT NULL DEFAULT true,
  low_stock_threshold numeric(20,6) NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  suggest_frequent_products boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, store_id)
);

-- The categories an outlet sells under the selected-categories policy; a chosen category includes its subcategories.
CREATE TABLE IF NOT EXISTS tenant.pos_outlet_assortment_categories (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, store_id, category_id),
  FOREIGN KEY (organization_id, category_id) REFERENCES tenant.item_groups (organization_id, id) ON DELETE CASCADE
);

-- ============================================================ 2. quick products

CREATE TABLE IF NOT EXISTS tenant.pos_quick_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 1000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_quick_products_item_uidx
  ON tenant.pos_quick_products (organization_id, store_id, item_id, COALESCE(uom_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS pos_quick_products_order_idx ON tenant.pos_quick_products (organization_id, store_id, sort_order);

-- ============================================================ 3. the unit a line is sold in

ALTER TABLE tenant.pos_cart_lines
  ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES tenant.units_of_measure(id),
  ADD COLUMN IF NOT EXISTS uom_factor numeric(24,10) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity numeric(20,6),
  ADD COLUMN IF NOT EXISTS scanned_barcode text;
ALTER TABLE tenant.pos_sale_lines
  ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES tenant.units_of_measure(id),
  ADD COLUMN IF NOT EXISTS uom_factor numeric(24,10) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity numeric(20,6);
-- Lines from before units were recorded were sold in the item's base unit.
UPDATE tenant.pos_cart_lines line SET uom_id = item.uom_id, base_quantity = line.quantity
  FROM tenant.items item WHERE item.organization_id = line.organization_id AND item.id = line.item_id AND line.uom_id IS NULL;
UPDATE tenant.pos_sale_lines line SET uom_id = item.uom_id, base_quantity = line.quantity
  FROM tenant.items item WHERE item.organization_id = line.organization_id AND item.id = line.item_id AND line.uom_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cart_lines_uom_factor_check') THEN
    ALTER TABLE tenant.pos_cart_lines ADD CONSTRAINT pos_cart_lines_uom_factor_check CHECK (uom_factor > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cart_lines_base_quantity_check') THEN
    ALTER TABLE tenant.pos_cart_lines ADD CONSTRAINT pos_cart_lines_base_quantity_check CHECK (base_quantity IS NULL OR base_quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_uom_factor_check') THEN
    ALTER TABLE tenant.pos_sale_lines ADD CONSTRAINT pos_sale_lines_uom_factor_check CHECK (uom_factor > 0);
  END IF;
END $$;

-- ============================================================ 4. request keys

CREATE TABLE IF NOT EXISTS tenant.pos_cart_request_keys (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cart_id uuid NOT NULL REFERENCES tenant.pos_carts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
  operation text NOT NULL DEFAULT 'add_item',
  line_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, cart_id, idempotency_key)
);

-- ============================================================ 5. search indexes on the item master

CREATE INDEX IF NOT EXISTS items_pos_name_trgm_idx ON tenant.items USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS items_pos_name_prefix_idx ON tenant.items (organization_id, lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS items_pos_parent_name_idx ON tenant.items (organization_id, parent_item_id, lower(name)) WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_pos_variant_template_idx ON tenant.items (organization_id) WHERE is_variant_template;

-- ============================================================ 6. diagnostic events

CREATE TABLE IF NOT EXISTS tenant.pos_product_search_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES tenant.pos_stores(id) ON DELETE SET NULL,
  terminal_id uuid REFERENCES tenant.pos_terminals(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('barcode_not_found', 'barcode_ambiguous', 'search_error', 'slow_search', 'slow_barcode')),
  search_text text CHECK (search_text IS NULL OR char_length(search_text) <= 100),
  result_count integer,
  duration_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_product_search_events_idx ON tenant.pos_product_search_events (organization_id, created_at DESC);

-- ============================================================ row security and grants

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_outlet_product_settings', 'pos_outlet_assortment_categories', 'pos_quick_products', 'pos_cart_request_keys',
    'pos_product_search_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_outlet_product_settings TO vercent_app;
GRANT SELECT, INSERT, DELETE ON tenant.pos_outlet_assortment_categories TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.pos_quick_products TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_cart_request_keys TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_product_search_events TO vercent_app;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0084_pos_product_search.sql', 'pos-product-search') ON CONFLICT DO NOTHING;
