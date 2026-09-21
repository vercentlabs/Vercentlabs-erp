BEGIN;

-- A reversed depreciation run must not block re-running the same cut-off date: history is kept, and only a
-- live (non-reversed) run is unique per company and cut-off.
ALTER TABLE tenant.asset_depreciation_runs DROP CONSTRAINT IF EXISTS asset_depreciation_runs_organization_id_company_id_period_end_key;
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_runs_live_uidx
  ON tenant.asset_depreciation_runs(organization_id,company_id,period_end) WHERE status<>'reversed';

COMMIT;
