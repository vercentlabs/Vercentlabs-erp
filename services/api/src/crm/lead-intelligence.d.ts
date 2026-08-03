import type { CrmFoundationContext, QueryClient } from "../index.js";
export const CRM_LEAD_INTELLIGENCE_CAPABILITY_IDS: readonly string[];
export class CrmLeadIntelligenceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmLeadIntelligenceHash(value: unknown): string;
export function evaluateLeadScoreRule(
  rule: Record<string, unknown>,
  lead: Record<string, unknown>,
  events?: Array<Record<string, unknown>>,
  now?: Date,
  halfLifeDays?: number,
): Record<string, unknown>;
export function calculateLeadScoreBreakdown(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function addBusinessMinutes(
  start: Date | string,
  minutes: number,
  schedule?: Record<string, unknown>,
): Date;
export function evaluateLeadSlaStatus(
  slaCase: Record<string, unknown>,
  now?: Date | string,
): Record<string, unknown>;
export function evaluateNurtureEligibility(
  lead: Record<string, unknown>,
  policy: Record<string, unknown>,
  now?: Date | string,
): Record<string, unknown>;
export function rankNurtureCandidate(
  input?: Record<string, unknown>,
  now?: Date | string,
): number;
export function recordLeadBehaviorEvent(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recalculateLeadScore(
  client: QueryClient,
  context: CrmFoundationContext,
  leadId: string,
  reason?: string,
): Promise<Record<string, unknown>>;
export function getLeadScoreExplanation(
  client: QueryClient,
  context: CrmFoundationContext,
  leadId: string,
): Promise<Record<string, unknown>>;
export function openLeadSlaCase(
  client: QueryClient,
  context: CrmFoundationContext,
  leadId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordLeadResponse(
  client: QueryClient,
  context: CrmFoundationContext,
  leadId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function scanLeadSlaBreaches(
  client: QueryClient,
  context: CrmFoundationContext,
  now?: Date | string,
): Promise<Record<string, unknown>>;
export function refreshLeadNurtureQueue(
  client: QueryClient,
  context: CrmFoundationContext,
  now?: Date | string,
): Promise<Record<string, unknown>>;
export function updateLeadNurtureItem(
  client: QueryClient,
  context: CrmFoundationContext,
  itemId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getLeadIntelligenceDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function recordCrmLeadIntelligenceAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmLeadIntelligenceReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
  commitSha?: string | null,
): Promise<Record<string, unknown>>;
