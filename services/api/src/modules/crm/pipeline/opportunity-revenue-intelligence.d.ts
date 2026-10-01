import type { CrmFoundationContext, QueryClient } from "../../../index.js";
export const CRM_OPPORTUNITY_REVENUE_CAPABILITY_IDS: readonly string[];
export class CrmOpportunityRevenueError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmOpportunityRevenueHash(value: unknown): string;
export function allocateExactAmounts(
  total: number,
  weights: number[],
): number[];
export function buildRecurringRevenueSchedule(
  input: Record<string, unknown>,
): Array<Record<string, unknown>>;
export function validateRevenueSplits(
  input: unknown,
): Array<Record<string, unknown>>;
export function evaluateMutualActionPlan(
  input: Record<string, unknown>,
  now?: Date,
): Record<string, unknown>;
export function calculatePredictiveForecast(
  input: Record<string, unknown>,
): Record<string, unknown>;
export function allocateQuotaSeasonality(
  input: Record<string, unknown>,
): Array<Record<string, unknown>>;
export function cloneOpportunityBlueprint(
  source: Record<string, unknown>,
  options?: Record<string, unknown>,
): Record<string, unknown>;
export function summarizeWinLoss(
  rows: Array<Record<string, unknown>>,
): Record<string, unknown>;
export function saveOpportunityRecurringRevenue(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveOpportunityRevenueSplits(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveMutualActionPlan(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function cloneOpportunity(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceOpportunityId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function submitWinLossReview(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function capturePredictiveForecast(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveQuotaSeasonality(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getOpportunityRevenueWorkspace(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
): Promise<Record<string, unknown>>;
export function getOpportunityRevenueDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function getForecastCalibration(
  client: QueryClient,
  context: CrmFoundationContext,
  limit?: number,
): Promise<Array<{
  periodId: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  modelVersion: string | null;
  confidencePercent: number;
  predictedAmount: number;
  actualWonAmount: number;
  errorAmount: number;
  errorPercent: number | null;
  capturedAt: string;
}>>;
export function recordCrmOpportunityRevenueAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmOpportunityRevenueReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
  commitSha?: string | null,
): Promise<Record<string, unknown>>;
