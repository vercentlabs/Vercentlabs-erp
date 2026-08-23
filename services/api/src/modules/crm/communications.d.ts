import type { CrmFoundationContext, QueryClient } from "../../index.js";

export const CRM_COMMUNICATION_CAPABILITY_IDS: readonly string[];
export class CrmCommunicationsError extends Error {
  readonly status: number;
  readonly code: string;
}
export function crmCommunicationsHash(value: unknown): string;
export function normalizeEmailAddress(value: unknown): string;
export function normalizeProviderMessage(
  provider: string,
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function normalizeProviderCalendarEvent(
  provider: string,
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function verifyCrmProviderWebhookSignature(
  input: Record<string, unknown>,
): boolean;
export function calculateMeetingSlots(
  input: Record<string, unknown>,
): Array<{ startsAt: string; endsAt: string }>;
export function outboundSendDecision(input: Record<string, unknown>): {
  allowed: boolean;
  reason: string | null;
};
export function createProviderOAuthState(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function consumeProviderOAuthState(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function createSharedInbox(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function upsertSharedInboxMember(
  client: QueryClient,
  context: CrmFoundationContext,
  inboxId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function upsertEmailSignature(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function listEmailSignatures(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Array<Record<string, unknown>>>;
export function ingestMailboxDelta(
  client: QueryClient,
  context: CrmFoundationContext,
  syncAccountId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function ingestCalendarDelta(
  client: QueryClient,
  context: CrmFoundationContext,
  syncAccountId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function claimSharedInboxThread(
  client: QueryClient,
  context: CrmFoundationContext,
  threadId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordEmailEngagementEvent(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function queueOutboundEmail(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getMeetingAvailability(
  client: QueryClient,
  context: CrmFoundationContext,
  meetingLinkId: string,
  date: string,
  input?: Record<string, unknown>,
): Promise<Array<{ startsAt: string; endsAt: string }>>;
export function bookMeeting(
  client: QueryClient,
  context: CrmFoundationContext,
  meetingLinkId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function resolveProviderCredential(
  reference: unknown,
  environment?: Record<string, string | undefined>,
): Record<string, unknown>;
export function fetchProviderMailboxDelta(
  account: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function fetchProviderCalendarDelta(
  account: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function synchronizeProviderAccount(
  client: QueryClient,
  context: CrmFoundationContext,
  syncAccountId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function cancelMeetingBooking(
  client: QueryClient,
  context: CrmFoundationContext,
  bookingId: string,
  reason?: string | null,
): Promise<Record<string, unknown>>;
export function rescheduleMeetingBooking(
  client: QueryClient,
  context: CrmFoundationContext,
  bookingId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCommunicationTimeline(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function getCommunicationsDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function recordCrmCommunicationsAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown> | null>;
export function getCrmCommunicationsReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
