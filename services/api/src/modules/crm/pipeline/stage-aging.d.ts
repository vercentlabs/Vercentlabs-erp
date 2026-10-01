import type { CrmContext, QueryClient } from "../index.js";

export type CrmStageAgeStatus = "ok" | "warning" | "breached" | "unknown";

export type CrmStageAge = {
  enteredAt: string | null;
  ageDays: number | null;
  maximumDays: number | null;
  status: CrmStageAgeStatus;
};

export type CrmStageTotalByCurrency = {
  opportunityCount: number;
  amount: number;
  weightedAmount: number;
};

export type CrmStageTotals = {
  opportunityCount: number;
  byCurrency: Record<string, CrmStageTotalByCurrency>;
};

export type CrmStageBottleneck = {
  stageId: string;
  name: string;
  sequence: number;
  opportunityCount: number;
  averageAgeDays: number;
  maximumDays: number | null;
  breachedCount: number;
  isBottleneck: boolean;
};

export type CrmStageSlaPolicy = {
  stageId: string;
  name: string;
  sequence: number;
  fallbackDays: number | null;
  policyId: string | null;
  overrideDays: number | null;
  overrideStatus: "active" | "inactive" | null;
  updatedAt: string | null;
};

export function listOpportunityPipelineStageTotals(
  client: QueryClient,
  context: CrmContext,
  pipelineId: string,
): Promise<Record<string, CrmStageTotals>>;

export function computeStageAge(
  row: Record<string, unknown>,
  now?: Date,
): CrmStageAge;

export function listOpportunityStageAges(
  client: QueryClient,
  context: CrmContext,
  pipelineId?: string | null,
): Promise<Record<string, CrmStageAge>>;

export function listOpportunityStageBottlenecks(
  client: QueryClient,
  context: CrmContext,
  pipelineId: string,
): Promise<CrmStageBottleneck[]>;

export function listStageSlaPolicies(
  client: QueryClient,
  context: CrmContext,
  pipelineId: string,
): Promise<CrmStageSlaPolicy[]>;

export function upsertStageSlaPolicy(
  client: QueryClient,
  context: CrmContext,
  input: {
    pipelineId: string;
    stageId: string;
    maximumDays?: number | string | null;
    status?: "active" | "inactive";
    expectedUpdatedAt?: string;
  },
): Promise<Record<string, unknown>>;
