import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;

// A sales stage as the settings screen sees it.
export type SalesStage = {
  id: string; code: string; name: string; description: string | null; guidance: string | null; sequence: number; probability: number;
  isActive: boolean; isStandard: boolean; openCount: number; isUsed: boolean; updatedAt: string;
  pipelineId: string; entryRules: StageRule[]; rulesAreStandard: boolean; timeLimitDays: number | null;
};
export type StageRuleKey = "contact" | "closeDate" | "amount" | "products" | "quotation" | "nextActivity";
export type StageRule = { rule: StageRuleKey; level: "require" | "warn" };
export type CrmPipeline = {
  id: string; code: string; name: string; description: string | null; isDefault: boolean; isActive: boolean; teamId: string | null; teamName: string | null;
  sequence: number; openCount: number; stageCount: number;
};
export type SalesStageAction = "log_activity" | "schedule_follow_up" | "edit_details" | "add_products" | "create_quotation" | "view_quotations" | "mark_won" | "mark_lost";

export const DEFAULT_SALES_STAGES: ReadonlyArray<{
  code: string; name: string; probability: number; forecastCategory: string; description?: string; guidance?: string; isWon?: boolean; isLost?: boolean;
}>;
export const DEFAULT_STAGE_CODES: ReadonlyArray<string>;
export function ensureDefaultSalesPipeline(client: QueryClient, context: CrmContext): Promise<void>;

export function listSalesStages(client: QueryClient, context: CrmContext, options?: { pipelineId?: string | null }): Promise<SalesStage[]>;
export function createSalesStage(client: QueryClient, context: CrmContext, input?: Input): Promise<SalesStage>;
export function updateSalesStage(client: QueryClient, context: CrmContext, stageId: string, input?: Input): Promise<SalesStage>;
export function setStageDefaultProbability(client: QueryClient, context: CrmContext, stageId: string, probability: unknown): Promise<SalesStage>;
export function deactivateSalesStage(client: QueryClient, context: CrmContext, stageId: string, options?: { moveOpenTo?: string | null }): Promise<SalesStage>;
export function reorderSalesStages(client: QueryClient, context: CrmContext, orderedIds: string[], options?: { pipelineId?: string | null }): Promise<SalesStage[]>;

export function listPipelines(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<CrmPipeline[]>;
export function resolvePipeline(client: QueryClient, context: CrmContext, pipelineId?: string | null): Promise<Record<string, any>>;
export function pipelineForTeam(client: QueryClient, context: CrmContext, teamId?: string | null): Promise<Record<string, any>>;
export function createPipeline(client: QueryClient, context: CrmContext, input?: Input): Promise<CrmPipeline>;
export function updatePipeline(client: QueryClient, context: CrmContext, pipelineId: string, input?: Input): Promise<CrmPipeline>;
export function setPipelineActive(client: QueryClient, context: CrmContext, pipelineId: string, active: boolean, options?: { moveOpenTo?: string | null }): Promise<CrmPipeline>;
export function moveOpportunityToPipeline(client: QueryClient, context: CrmContext, opportunityId: string,
  input: { pipelineId: string; stageId?: string | null; note?: string; expectedUpdatedAt?: string }): Promise<{ changed: boolean; pipelineId?: string; stageId?: string; probability?: number }>;
export const STAGE_RULES: Readonly<Record<StageRuleKey, { label: string; require: string; warn: string }>>;
export const STAGE_RULE_LEVELS: ReadonlyArray<"require" | "warn">;
export function stageRules(stage: Record<string, unknown>): StageRule[];

// row: an opportunity row (snake_case columns); stage: { code, name }.
export function stageEntryBlockers(row: Record<string, unknown>, stage: { code: string; name: string }): string[];
export function stageEntryWarnings(row: Record<string, unknown>, stage: { code: string; name: string }): string[];
export function stageRequirements(stage: { code: string; entry_rules?: unknown }): Array<{ key: string; label: string }>;
export function suggestedStageActions(stage: { code: string }): SalesStageAction[];
