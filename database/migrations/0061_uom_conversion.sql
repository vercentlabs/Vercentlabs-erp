-- 0061 UOM conversion: the shared conversion engine's guarantees, held by the database.
--
-- 1. Historical conversions are immutable: once a goods receipt, purchase return or confirmed purchase order carries its quantities,
--    units and conversion snapshot, those can no longer be rewritten; an inventory movement's quantity and entered unit never change.
--    A correction is a new document (a return, a reversal, an amendment while nothing has been done against the order).
-- 2. A delivery may be entered in another unit than its order line's (125 M against an order in ROLL of 50): what was entered is kept
--    beside the line, whose own quantity stays in the order's unit.

-- ============================================================ 1. immutable snapshots

CREATE OR REPLACE FUNCTION tenant.uom_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE locked boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'goods_receipt_lines' THEN
    SELECT receipt.status = 'posted' INTO locked FROM tenant.goods_receipts receipt WHERE receipt.organization_id = OLD.organization_id AND receipt.id = OLD.goods_receipt_id;
    IF locked AND (NEW.accepted_quantity, NEW.held_quantity, NEW.damaged_quantity, NEW.rejected_quantity, NEW.conversion_factor, NEW.base_quantity, NEW.receipt_uom_id,
                   NEW.entered_uom_id, NEW.entered_quantity, NEW.entered_conversion_factor)
        IS DISTINCT FROM (OLD.accepted_quantity, OLD.held_quantity, OLD.damaged_quantity, OLD.rejected_quantity, OLD.conversion_factor, OLD.base_quantity, OLD.receipt_uom_id,
                   OLD.entered_uom_id, OLD.entered_quantity, OLD.entered_conversion_factor) THEN
      RAISE EXCEPTION 'HISTORICAL_CONVERSION_IMMUTABLE: a posted goods receipt keeps its quantities and conversion.' USING ERRCODE = 'check_violation', CONSTRAINT = 'uom_snapshot_immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_return_lines' THEN
    SELECT purchase_return.document_status = 'posted' INTO locked FROM tenant.purchase_returns purchase_return
     WHERE purchase_return.organization_id = OLD.organization_id AND purchase_return.id = OLD.purchase_return_id;
    IF locked AND (NEW.quantity, NEW.conversion_factor, NEW.base_quantity, NEW.entered_uom_id, NEW.entered_quantity, NEW.entered_conversion_factor)
        IS DISTINCT FROM (OLD.quantity, OLD.conversion_factor, OLD.base_quantity, OLD.entered_uom_id, OLD.entered_quantity, OLD.entered_conversion_factor) THEN
      RAISE EXCEPTION 'HISTORICAL_CONVERSION_IMMUTABLE: a posted purchase return keeps its quantities and conversion.' USING ERRCODE = 'check_violation', CONSTRAINT = 'uom_snapshot_immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_order_lines' THEN
    SELECT purchase_order.status <> 'draft' INTO locked FROM tenant.purchase_orders purchase_order
     WHERE purchase_order.organization_id = OLD.organization_id AND purchase_order.id = OLD.purchase_order_id;
    IF locked AND (NEW.ordered_quantity, NEW.purchase_uom_id, NEW.conversion_factor, NEW.base_uom_id, NEW.base_quantity)
        IS DISTINCT FROM (OLD.ordered_quantity, OLD.purchase_uom_id, OLD.conversion_factor, OLD.base_uom_id, OLD.base_quantity) THEN
      RAISE EXCEPTION 'HISTORICAL_CONVERSION_IMMUTABLE: a confirmed purchase order keeps its quantities and conversion; amend it to change them.' USING ERRCODE = 'check_violation', CONSTRAINT = 'uom_snapshot_immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'stock_movements' THEN
    IF (NEW.item_id, NEW.quantity, NEW.entered_uom_id, NEW.entered_quantity, NEW.entered_conversion_factor)
        IS DISTINCT FROM (OLD.item_id, OLD.quantity, OLD.entered_uom_id, OLD.entered_quantity, OLD.entered_conversion_factor) THEN
      RAISE EXCEPTION 'HISTORICAL_CONVERSION_IMMUTABLE: an inventory movement keeps its quantity and unit; correct it with a new movement.' USING ERRCODE = 'check_violation', CONSTRAINT = 'uom_snapshot_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER goods_receipt_lines_uom_immutable BEFORE UPDATE ON tenant.goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION tenant.uom_snapshot_immutable();
CREATE OR REPLACE TRIGGER purchase_return_lines_uom_immutable BEFORE UPDATE ON tenant.purchase_return_lines FOR EACH ROW EXECUTE FUNCTION tenant.uom_snapshot_immutable();
CREATE OR REPLACE TRIGGER purchase_order_lines_uom_immutable BEFORE UPDATE ON tenant.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION tenant.uom_snapshot_immutable();
CREATE OR REPLACE TRIGGER stock_movements_uom_immutable BEFORE UPDATE ON tenant.stock_movements FOR EACH ROW EXECUTE FUNCTION tenant.uom_snapshot_immutable();

-- ============================================================ 2. deliveries entered in another unit

ALTER TABLE tenant.sales_delivery_lines
  ADD COLUMN IF NOT EXISTS entered_uom_id uuid,
  ADD COLUMN IF NOT EXISTS entered_quantity numeric(24, 6),
  ADD COLUMN IF NOT EXISTS entered_conversion_factor numeric(24, 10);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_delivery_lines_entered_uom_fkey') THEN
    ALTER TABLE tenant.sales_delivery_lines ADD CONSTRAINT sales_delivery_lines_entered_uom_fkey
      FOREIGN KEY (organization_id, entered_uom_id) REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0061_uom_conversion.sql', 'uom-conversion');
