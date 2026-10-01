"use client";

import type {
  CrmForecastFilters,
  CrmForecastRow,
  CrmListResponse,
  ForecastCalibrationRow,
  ForecastPeriod,
  ForecastSubmission,
  PredictiveForecastResult,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class CrmForecastApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(CrmForecastApiError);

// Reuses getCrmReport("forecast", ...) via the same /api/crm/reports/[report]
// boundary the Reports screen uses — no separate backend route.
export async function getCrmForecast(filters: CrmForecastFilters): Promise<{
  report: {
    rows: CrmForecastRow[];
    filters: { from: string | null; to: string | null };
    currency?: {
      reportingCurrency: string | null;
      unconvertedCount: number;
      unconvertedCurrencies: string[];
    };
  };
}> {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  const response = await fetch(
    `/api/crm/reports/forecast${query ? `?${query}` : ""}`,
  );
  return parseResponse(response);
}

// F025 Tranche K — the periods admin surface + a rep's own submission
// for a period. Both reuse the generic /api/crm/[resource] boundary
// (forecast-periods/forecast-submissions were already fully field-
// complete, zero frontend consumer before this pass).
export async function listForecastPeriods(): Promise<
  CrmListResponse<ForecastPeriod>
> {
  return request("/api/crm/forecast-periods?limit=100");
}
export async function createForecastPeriod(
  input: Record<string, unknown>,
): Promise<{ record: ForecastPeriod }> {
  return request("/api/crm/forecast-periods", { method: "POST", json: input });
}

export async function listForecastSubmissions(
  periodId: string,
): Promise<CrmListResponse<ForecastSubmission>> {
  return request(
    `/api/crm/forecast-submissions?periodId=${encodeURIComponent(periodId)}&limit=200`,
  );
}
export async function createForecastSubmission(
  input: Record<string, unknown>,
): Promise<{ record: ForecastSubmission }> {
  return request("/api/crm/forecast-submissions", {
    method: "POST",
    json: input,
  });
}
export async function updateForecastSubmission(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt?: string,
): Promise<{ record: ForecastSubmission }> {
  return request(`/api/crm/forecast-submissions/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}

// F025 Stage A2 §11 — accuracy/backtesting (getForecastCalibration) and
// predictive confidence (capturePredictiveForecast) already existed,
// fully built and tested, with zero frontend consumer.
export async function getForecastCalibration(
  limit?: number,
): Promise<{ rows: ForecastCalibrationRow[] }> {
  const response = await fetch(
    `/api/crm/forecast/calibration${limit ? `?limit=${limit}` : ""}`,
  );
  return parseResponse(response);
}
export async function capturePredictiveSnapshot(
  forecastPeriodId?: string,
): Promise<PredictiveForecastResult> {
  return request("/api/crm/forecast/predictive-snapshot", {
    method: "POST",
    json: { forecastPeriodId },
  });
}

// F025 governed forecast (services/api/.../forecast-service.js). Submissions,
// reviews and period lifecycle changes go only through these endpoints.
export type ForecastFigures = {
  pipeline: number;
  bestCase: number;
  commit: number;
  weighted: number;
  won: number;
  deals: number;
};

export type GovernedSubmission = {
  id: string;
  periodId: string;
  ownerUserId: string;
  ownerName: string | null;
  status: "draft" | "submitted" | "approved" | "rejected" | "superseded";
  version: number;
  commitAmount: string | number;
  bestCaseAmount: string | number;
  managerAdjustment: string | number;
  adjustmentReason: string | null;
  reviewNotes: string | null;
  reviewerName: string | null;
  notes: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
};

export type ForecastOwnerRow = {
  ownerUserId: string | null;
  ownerName: string;
  figures: ForecastFigures;
  submission: GovernedSubmission | null;
  adjustedCommit: number;
};

export type ForecastTeamNode = {
  id: string;
  name: string;
  parentTeamId: string | null;
  owners: ForecastOwnerRow[];
  children: ForecastTeamNode[];
  figures: ForecastFigures;
  rollup: { figures: ForecastFigures; adjustedCommit: number };
};

export type ForecastWorkspace = {
  period: {
    id: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    status: "planned" | "open" | "frozen" | "closed";
    updatedAt: string;
  };
  asOf: string;
  metricVersion: string;
  reportingCurrency: string | null;
  owners: ForecastOwnerRow[];
  rollup: {
    teams: ForecastTeamNode[];
    unattributed: {
      owners: ForecastOwnerRow[];
      figures: ForecastFigures;
      adjustedCommit: number;
    };
    total: { figures: ForecastFigures; adjustedCommit: number };
  };
  captures: Array<{
    id: string;
    captureKey: string;
    source: string;
    asOf: string;
    capturedAt: string;
    rowCount: number;
  }>;
  permissions: {
    submit: boolean;
    review: boolean;
    manage: boolean;
    reviewableOwners: "all" | string[];
  };
};

export type ForecastSnapshotRow = {
  scopeType: "organization" | "team" | "owner";
  scopeId: string | null;
  ownerUserId: string | null;
  teamId: string | null;
  pipelineAmount: string;
  bestCaseAmount: string;
  commitAmount: string;
  weightedAmount: string;
  wonAmount: string;
  submittedCommit: string | null;
  managerAdjustment: string | null;
  dealCount: number;
  totals: { label: string | null; adjustedCommit: number };
};

export type ForecastAccuracy = {
  scope: { ownerUserId?: string; organization?: boolean };
  horizonDays: number;
  periods: Array<{
    periodId: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    capturedAsOf: string | null;
    forecastCommit: number | null;
    forecastBestCase: number | null;
    actualWon: number;
    errorAmount: number | null;
    errorPercent: number | null;
    commitDeals: number;
    commitDealsWon: number;
    commitConversionPercent: number | null;
  }>;
  calibration: {
    periods: number;
    meanAbsolutePercentError: number | null;
    meanBiasPercent: number | null;
    withinTenPercent: number;
  };
};

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function getForecastWorkspace(
  periodId: string,
): Promise<ForecastWorkspace> {
  const payload = await parseResponse<{ forecast: ForecastWorkspace }>(
    await fetch(
      `/api/crm/forecast/workspace?periodId=${encodeURIComponent(periodId)}`,
    ),
  );
  return payload.forecast;
}

export async function submitGovernedForecast(input: {
  periodId: string;
  commitAmount: number;
  bestCaseAmount: number;
  notes: string;
  expectedVersion?: number;
}) {
  return parseResponse<{ submission: GovernedSubmission }>(
    await fetch("/api/crm/forecast/submissions", json("POST", input)),
  );
}

export async function reviewGovernedForecast(
  submissionId: string,
  input: {
    decision: "approve" | "reject" | "adjust";
    managerAdjustment?: number;
    reason?: string;
    expectedVersion: number;
  },
) {
  return parseResponse<{ submission: GovernedSubmission }>(
    await fetch(
      `/api/crm/forecast/submissions/${submissionId}/review`,
      json("POST", input),
    ),
  );
}

export async function listGovernedSubmissionEvents(submissionId: string) {
  return parseResponse<{
    events: Array<{
      id: string;
      eventType: string;
      nextStatus: string;
      commitAmount: string | null;
      managerAdjustment: string | null;
      reason: string | null;
      actorName: string | null;
      createdAt: string;
    }>;
  }>(await fetch(`/api/crm/forecast/submissions/${submissionId}/events`));
}

export async function setForecastPeriodStatus(
  periodId: string,
  status: string,
  expectedUpdatedAt?: string,
) {
  return parseResponse<{ period: { status: string } }>(
    await fetch(
      `/api/crm/forecast/periods/${periodId}/status`,
      json("POST", { status, expectedUpdatedAt }),
    ),
  );
}

export async function captureForecastSnapshot(
  periodId: string,
  idempotencyKey: string,
) {
  return parseResponse<{ capture: { id: string }; replayed: boolean }>(
    await fetch(
      `/api/crm/forecast/periods/${periodId}/snapshots`,
      json("POST", { idempotencyKey }),
    ),
  );
}

export async function getForecastSnapshot(captureId: string) {
  return parseResponse<{
    snapshot: {
      capture: {
        id: string;
        source: string;
        asOf: string;
        capturedAt: string;
        reportingCurrency: string | null;
      };
      rows: ForecastSnapshotRow[];
    };
  }>(await fetch(`/api/crm/forecast/snapshots/${captureId}`));
}

export async function getGovernedForecastAccuracy(
  horizonDays = 0,
): Promise<ForecastAccuracy> {
  const payload = await parseResponse<{ accuracy: ForecastAccuracy }>(
    await fetch(
      `/api/crm/forecast/accuracy?limit=8&horizonDays=${horizonDays}`,
    ),
  );
  return payload.accuracy;
}
