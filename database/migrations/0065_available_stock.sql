-- Available Stock: how much of an item can be committed to a new transaction now. It is derived, never stored or edited:
--
--   eligible on hand = on hand in allocatable positions (an available-disposition, allocation-enabled, active location; an active, unexpired batch)
--   available        = eligible on hand − active reservations held on it
--
-- What stock a location holds is now explicit: each location has a disposition (available, quality hold, quarantined, damaged) and whether
-- its stock may be allocated at all. Availability reads those — never a location's name or code — so held stock is excluded even when it was
-- put somewhere by mistake. Existing quality locations become quality-hold, non-allocating locations.

ALTER TABLE tenant.warehouse_locations
  ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS allow_allocation boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_locations_disposition_check') THEN
    ALTER TABLE tenant.warehouse_locations ADD CONSTRAINT warehouse_locations_disposition_check CHECK (disposition IN ('available', 'quality_hold', 'quarantined', 'damaged'));
  END IF;
  -- Held stock is never allocated; the default storage location (MAIN) always holds available, allocatable stock.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_locations_held_not_allocated_check') THEN
    ALTER TABLE tenant.warehouse_locations ADD CONSTRAINT warehouse_locations_held_not_allocated_check CHECK (disposition = 'available' OR NOT allow_allocation) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_locations_main_available_check') THEN
    ALTER TABLE tenant.warehouse_locations ADD CONSTRAINT warehouse_locations_main_available_check CHECK (NOT is_default_storage OR (disposition = 'available' AND allow_allocation)) NOT VALID;
  END IF;
END $$;

UPDATE tenant.warehouse_locations SET disposition = 'quality_hold', allow_allocation = false
 WHERE (location_type = 'quality' OR purpose = 'quality_hold') AND disposition = 'available';
ALTER TABLE tenant.warehouse_locations VALIDATE CONSTRAINT warehouse_locations_held_not_allocated_check;
ALTER TABLE tenant.warehouse_locations VALIDATE CONSTRAINT warehouse_locations_main_available_check;

-- A quality location (however it is created) holds quality-hold stock unless told otherwise, and held stock never allocates.
CREATE OR REPLACE FUNCTION tenant.warehouse_locations_disposition_defaults() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.location_type = 'quality' OR NEW.purpose = 'quality_hold') AND NEW.disposition = 'available' THEN
    NEW.disposition := 'quality_hold';
  END IF;
  IF NEW.disposition <> 'available' THEN
    NEW.allow_allocation := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER warehouse_locations_disposition_defaults BEFORE INSERT OR UPDATE OF location_type, purpose, disposition, allow_allocation ON tenant.warehouse_locations
  FOR EACH ROW EXECUTE FUNCTION tenant.warehouse_locations_disposition_defaults();


INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0065_available_stock.sql', 'available-stock');
