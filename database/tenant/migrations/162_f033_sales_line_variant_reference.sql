BEGIN;

-- F033 (Products and services): a quotation/order line could only ever
-- reference a parent item, never one of its sellable variants/SKUs (size,
-- colour, pack) -- so "sell 20 cartons of the Large/Brown Corrugated Box"
-- had no way to be recorded distinctly from the base item. Lines are
-- immutable per document version, so this is additive and nullable: existing
-- rows simply have no variant.
ALTER TABLE tenant.sales_quotation_lines
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES tenant.item_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variant_sku_snapshot text;

ALTER TABLE tenant.sales_order_lines
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES tenant.item_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variant_sku_snapshot text;

CREATE INDEX IF NOT EXISTS sales_quotation_lines_variant_idx
  ON tenant.sales_quotation_lines(organization_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_order_lines_variant_idx
  ON tenant.sales_order_lines(organization_id, variant_id) WHERE variant_id IS NOT NULL;

COMMIT;
