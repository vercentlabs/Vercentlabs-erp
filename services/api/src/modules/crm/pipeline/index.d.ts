import type { CrmContext } from "@vercentlabs/shared-types";

import type { Opportunity, OpportunityCapabilities } from "../opportunities/index.js";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;

export type PipelineStageColumn = {
  id: string; code: string; name: string; sequence: number; probability: number; isInactive: boolean;
  count: number; value: number; weightedValue: number; averageDaysInStage: number | null; cards: Opportunity[]; hasMore: boolean;
};
export type OpportunityPipeline = {
  status: "open" | "won" | "lost" | "all"; cardSort: string; cardsPerStage: number; stages: PipelineStageColumn[];
  total: number; totalValue: number; weightedValue: number; capabilities: OpportunityCapabilities;
};
type PipelineBreakdownRow = { id: string | null; label: string; total: number; value: number; weightedValue: number };
export type PipelineSummary = {
  totals: {
    open: number; value: number; weightedValue: number; closingThisMonth: number; closingThisMonthValue: number; overdue: number; stale: number;
    staleDays: number; noNextActivity: number;
  };
  byOwner: Array<PipelineBreakdownRow & { stages: Array<{ stageId: string; total: number; value: number }> }>;
  bySource: PipelineBreakdownRow[];
  stageAging: Array<{ stageId: string; entered: number; averageDays: number | null; conversionRate: number | null }>;
};
export function getOpportunityPipeline(client: QueryClient, context: CrmContext, filters?: Input): Promise<OpportunityPipeline>;
export function getPipelineSummary(client: QueryClient, context: CrmContext, filters?: Input): Promise<PipelineSummary>;
export function quickEditOpportunity(client: QueryClient, context: CrmContext, opportunityId: string, input?: Input): Promise<Opportunity>;
