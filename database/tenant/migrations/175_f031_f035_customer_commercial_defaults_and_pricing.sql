BEGIN;

-- F031 (benchmark: "Customer master in top ERPs"): the customer carried only
-- currency, payment terms and a credit limit. Every ERP reviewed also keeps a
-- default price list, a tax treatment (India: GST treatment), shipping/
-- delivery defaults and a sales block that stops new documents
-- (SAP order block, D365 "on hold", Business Central "Blocked").
ALTER TABLE tenant.business_parties
  ADD COLUMN IF NOT EXISTS default_price_list_id uuid,
  ADD COLUMN IF NOT EXISTS tax_treatment text,
  ADD COLUMN IF NOT EXISTS default_shipping_method text,
  ADD COLUMN IF NOT EXISTS default_delivery_terms text,
  ADD COLUMN IF NOT EXISTS default_incoterm text,
  ADD COLUMN IF NOT EXISTS sales_block text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS sales_block_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_parties_default_price_list_fkey') THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_default_price_list_fkey
      FOREIGN KEY (organization_id, default_price_list_id)
      REFERENCES tenant.price_lists(organization_id, id) ON DELETE SET NULL (default_price_list_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_parties_tax_treatment_check') THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_tax_treatment_check
      CHECK (tax_treatment IS NULL OR tax_treatment IN (
        'registered_regular', 'registered_composition', 'unregistered', 'consumer', 'overseas', 'sez', 'deemed_export'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_parties_sales_block_check') THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_sales_block_check
      CHECK (sales_block IN ('none', 'orders', 'all'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_parties_sales_block_reason_check') THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_sales_block_reason_check
      CHECK (sales_block = 'none' OR length(btrim(coalesce(sales_block_reason, ''))) >= 5);
  END IF;
END $$;

-- F034: a price-list row can be specific to one variant, but the uniqueness
-- key ignored variant_id, so a second variant's rate for the same item/UOM/
-- quantity break/start date collided with the first.
ALTER TABLE tenant.price_list_items
  DROP CONSTRAINT IF EXISTS price_list_items_organization_id_price_list_id_item_id_uom__key;
CREATE UNIQUE INDEX IF NOT EXISTS price_list_items_variant_scoped_uidx
  ON tenant.price_list_items (organization_id, price_list_id, item_id, uom_id, variant_id, minimum_quantity, valid_from);

-- F035: a changed negotiated price is kept as history (the old row is
-- retired and points at its successor) instead of being overwritten.
ALTER TABLE tenant.sales_pricing_rules
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

COMMIT;
