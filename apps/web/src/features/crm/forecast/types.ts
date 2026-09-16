// getCrmReport(client, context, "forecast", filters)'s row shape
// (services/api/src/modules/crm/pipeline-analytics-and-forecasting/
// analytics-service.js) — grouped by opportunity owner. For a sales
// manager without crm.records.view_all, this now also rolls up their
// active team members via ownerVisibleForForecast(), not just their own
// deals (see the register's Checkpoint re-audit #3).
export type CrmForecastRow = {
  owner: string;
  // F025 Stage A2 §11 — added so "By owner" rows can drill into a real,
  // authorized Opportunity list filtered by owner, instead of the
  // display-name-only row this report previously returned (a name is
  // not a safe/unique filter key).
  ownerUserId: string | null;
  // ::numeric-cast SQL aggregates — node-postgres returns these as strings
  // at runtime, not numbers (see shared/format.ts's money()).
  pipeline: number | string;
  weighted: number | string;
  won: number | string;
  // F025 Stage A2 §11 — per-category breakdown (open pipeline only).
  bestCase: number | string;
  commitAmount: number | string;
};

export type CrmForecastFilters = { from?: string; to?: string };

// tenant.crm_forecast_periods / crm_forecast_submissions via the generic
// /api/crm/[resource] boundary — F025's own dossier names "submit, roll
// up, adjust and later reproduce a forecast period" as its primary
// capability (F025-CAP-001), not the read-only aggregate view this
// screen had before this pass. Both tables/resources already existed,
// fully field-complete, with zero frontend consumer (confirmed by grep).
export type ForecastPeriod = {
  id: string;
  companyId: string | null;
  name: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  currencyCode: string | null;
  freezeAt: string | null;
  // F025 Stage A2 §11 correction — this was wrongly typed "active" |
  // "inactive"; tenant.crm_forecast_periods' real CHECK constraint
  // (003_crm_enterprise_core.sql) is planned/open/frozen/closed. 'frozen'
  // stays mutable (see assertForecastPeriodMutable); only 'closed' locks
  // a period against further submission.
  status: "planned" | "open" | "frozen" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type ForecastSubmission = {
  id: string;
  companyId: string | null;
  periodId: string;
  teamId: string | null;
  territoryId: string | null;
  ownerUserId: string;
  // numeric(18,2)-shaped amounts — see CrmForecastRow's own caveat.
  pipelineAmount: number | string | null;
  bestCaseAmount: number | string | null;
  commitAmount: number | string | null;
  closedAmount: number | string | null;
  managerAdjustment: number | string | null;
  currencyCode: string | null;
  confidencePercent: number | string | null;
  notes: string | null;
  // F025 Stage A2 §11 correction — this was wrongly typed "active" |
  // "inactive"; the real, enforced lifecycle (assertLifecycleUpdate,
  // record-policy.js) is draft/submitted/approved/rejected/superseded.
  status: "draft" | "submitted" | "approved" | "rejected" | "superseded";
  updatedAt: string;
  createdAt: string;
};

// getForecastCalibration's row shape (opportunity-revenue-intelligence.js)
// — the dossier's "accuracy/backtesting" requirement. Compares each
// closed period's real predictive-forecast snapshot against the period's
// actual won revenue; never recalculates a new prediction from today's
// data and calls it historical.
export type ForecastCalibrationRow = {
  periodId: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  modelVersion: string;
  confidencePercent: number | string;
  predictedAmount: number | string;
  actualWonAmount: number | string;
  errorAmount: number | string;
  errorPercent: number | string | null;
  capturedAt: string;
};

// capturePredictiveForecast's return shape. snapshot is the raw
// (snake_case) INSERT...RETURNING * row — NOT camelized, unlike most of
// this codebase's read paths (the same two-tier-projection gap found
// elsewhere this session, e.g. lead-assignment-policies). forecast is a
// plain object calculatePredictiveForecast builds directly in JS, so it
// IS already camelCase.
export type PredictiveForecastResult = {
  snapshot: { id: string; forecast_period_id: string | null; model_version: string; predicted_amount: number | string; confidence_percent: number | string; captured_at: string };
  forecast: { modelVersion: string; pipelineAmount: number; predictedAmount: number; confidence: number; opportunityCount: number };
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
