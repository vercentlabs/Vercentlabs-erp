BEGIN;
-- The accounting close workflow (updateFiscalPeriodStatus) moves a period open -> soft_closed -> closed,
-- but the original fiscal_periods constraint only allowed open/closed/locked, so a soft close always failed.
ALTER TABLE tenant.fiscal_periods DROP CONSTRAINT IF EXISTS fiscal_periods_status_check;
ALTER TABLE tenant.fiscal_periods
  ADD CONSTRAINT fiscal_periods_status_check CHECK (status IN ('open', 'soft_closed', 'closed', 'locked'));

COMMIT;
