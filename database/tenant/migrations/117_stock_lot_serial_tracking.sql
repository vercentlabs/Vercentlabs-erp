BEGIN;

-- F295 (Stock module gap that blocks POS): tenant.items had no column
-- indicating an item requires serial or batch/lot tracking, and
-- tenant.stock_serials.status (added in migration 044, default
-- 'available') had no CHECK constraint pinning its vocabulary and no code
-- anywhere ever transitioned it -- a serial could be sold an unlimited
-- number of times with no detection at all. See services/api/src/modules/
-- stock/index.js's postStockMovement for the enforcement this column and
-- constraint make possible.
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS tracking_type text NOT NULL DEFAULT 'none';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.items'::regclass AND conname = 'items_tracking_type_check'
  ) THEN
    ALTER TABLE tenant.items
      ADD CONSTRAINT items_tracking_type_check CHECK (tracking_type IN ('none', 'batch', 'serial'));
  END IF;
END $$;

-- tenant.stock_serials.status has driven an available/sold distinction by
-- convention (default 'available') since migration 044, but nothing ever
-- formalized the vocabulary or actually flipped it. postStockMovement is
-- now the first and only code that transitions it: 'available' -> 'sold'
-- on an issue, 'sold' -> 'available' on a receipt that restocks a
-- previously sold serial (e.g. a full return) -- see the accompanying
-- application-code change for the exact rule and its documented rationale.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.stock_serials'::regclass AND conname = 'stock_serials_status_check'
  ) THEN
    ALTER TABLE tenant.stock_serials
      ADD CONSTRAINT stock_serials_status_check CHECK (status IN ('available', 'sold'));
  END IF;
END $$;

COMMIT;
