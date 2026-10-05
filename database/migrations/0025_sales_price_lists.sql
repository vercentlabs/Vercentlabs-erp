-- Price Lists (Sales).
--
-- 1. Price list: a description and a default flag. There is at most one
--    default sales price list per currency; the default formerly kept in
--    Sales settings becomes the flagged list.
-- 2. Entries: every price is for a unit. An entry with no unit was the base
--    unit and now says so. Quantity breaks are not part of the price list:
--    entries for a minimum quantity above one are made inactive.
-- 3. Price list history: who changed which list or price, when, from what.
-- 4. Permissions for price list maintenance, granted to the roles that
--    managed price lists through Sales settings until now.

-- ============================================================ 1. price list

ALTER TABLE tenant.price_lists
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

UPDATE tenant.price_lists list SET is_default = true
  FROM tenant.sales_settings settings
 WHERE settings.organization_id = list.organization_id AND settings.default_price_list_id = list.id
   AND list.price_list_type = 'sales' AND list.status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS price_lists_default_currency_uidx
  ON tenant.price_lists (organization_id, currency_code) WHERE is_default AND price_list_type = 'sales';

ALTER TABLE tenant.price_lists
  ADD CONSTRAINT price_lists_default_active_check CHECK (NOT is_default OR status = 'active');

-- ============================================================ 2. entries

UPDATE tenant.price_list_items entry SET uom_id = item.uom_id
  FROM tenant.items item
 WHERE item.organization_id = entry.organization_id AND item.id = entry.item_id AND entry.uom_id IS NULL;

UPDATE tenant.price_list_items SET status = 'inactive' WHERE minimum_quantity > 1 AND status = 'active';

-- Every price says which unit it is for.
ALTER TABLE tenant.price_list_items ADD CONSTRAINT price_list_items_uom_required_check CHECK (uom_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS price_list_items_entry_idx
  ON tenant.price_list_items (organization_id, price_list_id, item_id, uom_id) WHERE status = 'active';

-- ============================================================ 3. history

CREATE TABLE IF NOT EXISTS tenant.price_list_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL,
  entry_id uuid,
  item_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'default_changed', 'activated', 'deactivated', 'copied',
                                                 'price_added', 'price_changed', 'price_expired', 'price_removed', 'imported')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, price_list_id) REFERENCES tenant.price_lists (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS price_list_history_list_idx ON tenant.price_list_history (organization_id, price_list_id, created_at DESC);
CREATE INDEX IF NOT EXISTS price_list_history_item_idx ON tenant.price_list_history (organization_id, price_list_id, item_id, created_at DESC) WHERE item_id IS NOT NULL;

ALTER TABLE tenant.price_list_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.price_list_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.price_list_history
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.price_list_history TO vercent_app;
GRANT SELECT ON tenant.price_list_history TO vercent_worker;

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.price_lists.view', 'View price lists', 'Sales', 'Open price lists and their prices, and choose a price list on a document.'),
  ('sales.price_lists.create', 'Create price lists', 'Sales', 'Create a price list, or copy one.'),
  ('sales.price_lists.edit', 'Edit price lists', 'Sales', 'Change a price list''s name, description, currency and validity.'),
  ('sales.price_lists.manage_prices', 'Add and edit prices', 'Sales', 'Add, change, expire and remove the prices on a price list.'),
  ('sales.price_lists.activate', 'Activate and deactivate price lists', 'Sales', 'Make a price list active or inactive, or delete an unused one.'),
  ('sales.price_lists.set_default', 'Set default price list', 'Sales', 'Choose the default sales price list for a currency.'),
  ('sales.price_lists.change_tax_mode', 'Change price list tax mode', 'Sales', 'Switch a price list between tax-inclusive and tax-exclusive prices.'),
  ('sales.price_lists.import', 'Import prices', 'Sales', 'Import prices into a price list from a CSV or Excel file.'),
  ('sales.price_lists.export', 'Export prices', 'Sales', 'Export a price list.')
ON CONFLICT (key) DO NOTHING;

-- Whoever can open Sales sees price lists and uses them on documents.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.price_lists.view'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.view'
ON CONFLICT DO NOTHING;

-- Sales administrators, who maintained price lists until now, keep doing so.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'sales.price_lists.create', 'sales.price_lists.edit', 'sales.price_lists.manage_prices', 'sales.price_lists.activate', 'sales.price_lists.set_default',
    'sales.price_lists.change_tax_mode', 'sales.price_lists.import', 'sales.price_lists.export'])
 WHERE existing.permission_key = 'sales.settings.manage'
ON CONFLICT DO NOTHING;

-- Whoever may override prices on a document may export the lists they price from.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.price_lists.export'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.price.override'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0025_sales_price_lists.sql', 'sales-price-lists');
