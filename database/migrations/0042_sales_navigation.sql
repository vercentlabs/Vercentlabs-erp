-- Sales navigation and settings.
--
-- Sales Settings → Fulfillment gains the warehouse a new sales order starts
-- with. It is only a starting value: the order form can change it, and each
-- line can still use another warehouse. The warehouse belongs to the same
-- organization (composite key), and the setting clears itself if the
-- warehouse is ever deleted.
--
-- Nothing else here changes the schema: the Sales home, the reports page and
-- Sales → Refunds read what already exists.

ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS default_warehouse_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_default_warehouse_fkey') THEN
    ALTER TABLE tenant.sales_settings
      ADD CONSTRAINT sales_settings_default_warehouse_fkey FOREIGN KEY (organization_id, default_warehouse_id)
      REFERENCES tenant.warehouses (organization_id, id) ON DELETE SET NULL (default_warehouse_id);
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0042_sales_navigation.sql', 'sales-navigation');
