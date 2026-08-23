import type { CrmFoundationContext, QueryClient } from "../../index.js";
export const CRM_MARKETING_CAPABILITY_IDS: readonly string[];
export class CrmMarketingError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmMarketingHash(value: unknown): string;
export function normalizeMarketingSegmentDefinition(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function compileMarketingSegmentFilter(
  subjectType: string,
  filters?: Record<string, unknown>,
  startIndex?: number,
): { clause: string; values: unknown[] };
export function normalizeJourneyDefinition(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function assignMarketingExperimentVariant(
  subjectKey: string,
  variants: Array<Record<string, unknown>>,
): string;
export function calculateMarketingAttributionWeights(
  touchpoints: Array<Record<string, unknown>>,
  model?: string,
): Array<Record<string, unknown>>;
export function evaluateMarketingFrequencyPolicy(
  input?: Record<string, unknown>,
): { eligible: boolean; reason: string | null };
export function validateMarketingSurveyDefinition(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function buildMarketingDeliveryCommand(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function saveMarketingSegment(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function refreshMarketingSegment(
  client: QueryClient,
  context: CrmFoundationContext,
  segmentId: string,
): Promise<Record<string, unknown>>;
export function saveMarketingCampaign(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function createMarketingCampaignRun(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function processMarketingCampaignRun(
  client: QueryClient,
  context: CrmFoundationContext,
  runId: string,
): Promise<Record<string, unknown>>;
export function saveMarketingJourney(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function enrollMarketingJourney(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function advanceMarketingJourney(
  client: QueryClient,
  context: CrmFoundationContext,
  enrollmentId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveMarketingExperiment(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveMarketingEvent(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function registerMarketingEvent(
  client: QueryClient,
  context: CrmFoundationContext,
  eventId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function saveMarketingSurvey(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function submitMarketingSurveyResponse(
  client: QueryClient,
  context: CrmFoundationContext,
  survey: Record<string, unknown>,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordMarketingTouchpoint(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getMarketingAttributionReport(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getMarketingDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function recordCrmMarketingAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmMarketingReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
  commitSha?: string | null,
): Promise<Record<string, unknown>>;
