// tenant.crm_pipelines rows via the generic /api/crm/[resource] boundary
// (pipelines has no governance redirect, unlike stages).
export type CrmPipeline = {
  id: string;
  companyId: string | null;
  name: string;
  code: string;
  description: string | null;
  isDefault: boolean;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

// tenant.crm_pipeline_stages rows via the dedicated sales-stage-
// operations.js module.
export type CrmStageType = "open" | "won" | "lost";

export const FORECAST_CATEGORIES = ["omitted", "pipeline", "best_case", "committed", "closed"] as const;

export type CrmSalesStage = {
  id: string;
  pipelineId: string;
  name: string;
  code: string;
  sequence: number;
  probability: number;
  forecastCategory: string;
  isWon: boolean;
  isLost: boolean;
  staleAfterDays: number | null;
  status: "active" | "inactive";
  stageType: CrmStageType;
  updatedAt: string;
  openOpportunityCount?: number;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
