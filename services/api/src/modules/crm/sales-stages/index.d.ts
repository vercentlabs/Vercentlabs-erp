import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;

// A sales stage as the settings screen sees it.
export type SalesStage = {
  id: string; code: string; name: string; description: string | null; guidance: string | null; sequence: number; probability: number;
  isActive: boolean; isStandard: boolean; openCount: number; isUsed: boolean; updatedAt: string;
};
export type SalesStageAction = "log_activity" | "schedule_follow_up" | "edit_details" | "add_products" | "create_quotation" | "view_quotations" | "mark_won" | "mark_lost";

export const DEFAULT_SALES_STAGES: ReadonlyArray<{
  code: string; name: string; probability: number; forecastCategory: string; description?: string; guidance?: string; isWon?: boolean; isLost?: boolean;
}>;
export const DEFAULT_STAGE_CODES: ReadonlyArray<string>;
export function ensureDefaultSalesPipeline(client: QueryClient, context: CrmContext): Promise<void>;

export function listSalesStages(client: QueryClient, context: CrmContext): Promise<SalesStage[]>;
export function createSalesStage(client: QueryClient, context: CrmContext, input?: Input): Promise<SalesStage>;
export function updateSalesStage(client: QueryClient, context: CrmContext, stageId: string, input?: Input): Promise<SalesStage>;
export function setStageDefaultProbability(client: QueryClient, context: CrmContext, stageId: string, probability: unknown): Promise<SalesStage>;
export function deactivateSalesStage(client: QueryClient, context: CrmContext, stageId: string, options?: { moveOpenTo?: string | null }): Promise<SalesStage>;
export function reorderSalesStages(client: QueryClient, context: CrmContext, orderedIds: string[]): Promise<SalesStage[]>;

// row: an opportunity row (snake_case columns); stage: { code, name }.
export function stageEntryBlockers(row: Record<string, unknown>, stage: { code: string; name: string }): string[];
export function stageEntryWarnings(row: Record<string, unknown>, stage: { code: string; name: string }): string[];
export function suggestedStageActions(stage: { code: string }): SalesStageAction[];
