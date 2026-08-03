import type { CrmFoundationContext, QueryClient } from "../index.js";

export const CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS: readonly string[];
export class CrmCustomerSuccessError extends Error {
  readonly status: number;
  readonly code: string;
}
export function crmCustomerSuccessHash(value: unknown): string;
export function normalizeCustomerFeedbackScore(
  surveyType: string,
  rawScore: unknown,
): number;
export function customerSuccessHealthFromSignals(
  input?: Record<string, unknown>,
): { score: number; status: string; reasons: string[] };
export function createCustomerSuccessPlan(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function updateCustomerSuccessMilestone(
  client: QueryClient,
  context: CrmFoundationContext,
  milestoneId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function ingestProductUsageEvent(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordCustomerFeedback(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function upsertRenewalCase(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function createChurnIntervention(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function resolveChurnIntervention(
  client: QueryClient,
  context: CrmFoundationContext,
  interventionId: string,
  resolution: string,
): Promise<Record<string, unknown>>;
export function recalculateCustomerHealth(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
): Promise<Record<string, unknown>>;
export function getCustomerSuccessAccount(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
): Promise<Record<string, unknown>>;
export function getCustomerSuccessDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function recordCrmCustomerSuccessAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmCustomerSuccessReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
