import type { CrmContext, QueryClient } from "../index.js";

export type CrmSalesStagePipeline = Record<string, unknown> & {
  id: string;
  name: string;
  code: string;
  companyId: string | null;
  isDefault: boolean;
  status: "active" | "inactive";
  updatedAt: string;
  activeOpenStageCount: number;
  activeWonStageCount: number;
  activeLostStageCount: number;
};

export type CrmSalesStage = Record<string, unknown> & {
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
  stageType: "open" | "won" | "lost";
  updatedAt: string;
  openOpportunityCount?: number;
};

export function listSalesStagePipelines(
  client: QueryClient,
  context: CrmContext,
  options?: { status?: "active" | "inactive" | "all" },
): Promise<CrmSalesStagePipeline[]>;

export function listSalesStages(
  client: QueryClient,
  context: CrmContext,
  options: { pipelineId: string; status?: "active" | "inactive" | "all" },
): Promise<{ rows: CrmSalesStage[]; total: number }>;

export function getSalesStage(
  client: QueryClient,
  context: CrmContext,
  id: string,
  options?: { lock?: boolean },
): Promise<CrmSalesStage>;

export function listSalesStageHistory(
  client: QueryClient,
  context: CrmContext,
  pipelineId: string,
  limit?: number,
): Promise<Array<Record<string, unknown>>>;

export function createSalesStage(
  client: QueryClient,
  context: CrmContext,
  input?: Record<string, unknown>,
): Promise<CrmSalesStage>;

export function updateSalesStage(
  client: QueryClient,
  context: CrmContext,
  id: string,
  input?: Record<string, unknown>,
): Promise<CrmSalesStage>;

export function setSalesStageActive(
  client: QueryClient,
  context: CrmContext,
  id: string,
  active: boolean,
  expectedUpdatedAt: string,
): Promise<CrmSalesStage & { replayed?: boolean }>;

export function reorderSalesStages(
  client: QueryClient,
  context: CrmContext,
  pipelineId: string,
  entries?: Array<{ id: string; expectedUpdatedAt: string }>,
): Promise<{ changed: boolean; rows: CrmSalesStage[] }>;
