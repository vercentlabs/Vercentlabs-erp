BEGIN;

-- F274 gap closure (POS Completion Program, comprehensive completion
-- pass): the gap matrix disclosed "no variant-specific pricing" -- POS
-- carries variant_id end-to-end through cart/sale lines, but the price
-- resolver only ever matched tenant.price_list_items on item_id, so two
-- variants of the same item (e.g. a Small vs. a Large size) always
-- resolved to the identical price-list rate. Sales itself never uses
-- item variants (confirmed: no variant_id reference anywhere in
-- services/api/src/modules/sales/index.js), so this column is additive
-- and backward-compatible for every existing Sales price-list row --
-- NULL means "applies to the item generically, regardless of variant,"
-- exactly the same meaning every pre-existing row already has today.
ALTER TABLE tenant.price_list_items
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES tenant.item_variants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS price_list_items_variant_idx
  ON tenant.price_list_items(organization_id, price_list_id, item_id, variant_id)
  WHERE variant_id IS NOT NULL;

COMMIT;
