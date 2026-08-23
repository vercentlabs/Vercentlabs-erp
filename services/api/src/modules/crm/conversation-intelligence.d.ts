import type { CrmFoundationContext, QueryClient } from "../../index.js";
export const CRM_CONVERSATION_CAPABILITY_IDS: readonly string[];
export class CrmConversationIntelligenceError extends Error {
  readonly status: number;
  readonly code: string;
}
export function crmConversationHash(value: unknown): string;
export function normalizePhoneNumber(
  value: unknown,
  defaultCountryCode?: string,
): string;
export function verifyTelephonyWebhookSignature(
  input?: Record<string, unknown>,
): boolean;
export function normalizeTelephonyEvent(
  provider: string,
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function telephonyTransitionAllowed(
  fromStatus: string,
  eventType: string,
): boolean;
export function buildConversationInsights(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function createTelephonyConnection(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function startClickToCall(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function ingestTelephonyWebhook(
  client: QueryClient,
  context: CrmFoundationContext,
  connectionId: string,
  provider: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function registerConversationRecording(
  client: QueryClient,
  context: CrmFoundationContext,
  conversationId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function issueRecordingAccessGrant(
  client: QueryClient,
  context: CrmFoundationContext,
  recordingId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function requestConversationTranscription(
  client: QueryClient,
  context: CrmFoundationContext,
  conversationId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function completeConversationTranscription(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getConversationIntelligenceTimeline(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function getConversationIntelligenceDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function recordCrmConversationAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown> | null>;
export function getCrmConversationReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
