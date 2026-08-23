import type { QueryClient } from "../../index.js";
export type CrmPartnerEngagementContext = {
  organizationId: string;
  userId: string;
  activeCompanyId?: string | null;
  activeBranchId?: string | null;
};
export const CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS: readonly string[];
export class CrmPartnerEngagementError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmPartnerEngagementHash(value: unknown): string;
export function validateJourneyBranchGraph(
  steps: unknown,
): Record<string, unknown>;
export function validateFieldVisit(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function buildCrossChannelCampaignPlan(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function routeInboundEmail(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function evaluatePartnerDealConflict(
  existing: unknown,
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function calculatePartnerIncentive(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function calculateConversationScore(
  criteria: unknown,
  observations?: Record<string, unknown>,
): Record<string, unknown>;
export function calculateGamificationAwards(
  events: unknown,
  rules: unknown,
): Record<string, unknown>;
export function registerPartnerDeal(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function submitMdfRequest(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordFieldVisit(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveSequenceBranch(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function createCoachingScorecard(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function awardGamificationPoints(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function processInboundEmail(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getPartnerEngagementDashboard(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
): Promise<Record<string, unknown>>;
export function recordCrmPartnerEngagementAcceptance(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmPartnerEngagementReadiness(
  client: QueryClient,
  context: CrmPartnerEngagementContext,
  commitSha?: string,
): Promise<Record<string, unknown>>;
