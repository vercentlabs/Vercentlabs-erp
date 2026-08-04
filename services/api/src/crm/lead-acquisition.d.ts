import type { CrmFoundationContext, QueryClient } from "../index.js";
export const CRM_LEAD_ACQUISITION_CAPABILITY_IDS: readonly string[];
export class CrmLeadAcquisitionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmLeadAcquisitionHash(value: unknown): string;
export function normalizeLeadFieldMapping(
  mapping?: Record<string, unknown>,
): Record<string, string>;
export function validateLeadImportRows(
  rows: unknown[],
  mapping?: Record<string, unknown>,
): Array<Record<string, unknown>>;
export function verifyLeadAcquisitionWebhookSignature(
  input: Record<string, unknown>,
): boolean;
export function normalizeLeadAcquisitionEvent(
  provider: string,
  payload?: Record<string, unknown>,
): Record<string, unknown>;
export function buildLeadFormDefinition(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function buildEnrichmentReview(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function previewLeadImport(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function commitLeadImport(
  client: QueryClient,
  context: CrmFoundationContext,
  batchId: string,
): Promise<Record<string, unknown>>;
export function rollbackLeadImport(
  client: QueryClient,
  context: CrmFoundationContext,
  batchId: string,
): Promise<Record<string, unknown>>;
export function saveLeadForm(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function publishLeadForm(
  client: QueryClient,
  context: CrmFoundationContext,
  formId: string,
): Promise<Record<string, unknown>>;
export function submitPublishedLeadForm(
  client: QueryClient,
  context: CrmFoundationContext,
  form: Record<string, unknown>,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function createLeadAcquisitionConnection(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function ingestLeadAcquisitionWebhook(
  client: QueryClient,
  context: CrmFoundationContext,
  connectionId: string,
  provider: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function startLeadChatSession(
  client: QueryClient,
  context: CrmFoundationContext,
  connectionId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function appendLeadChatMessage(
  client: QueryClient,
  context: CrmFoundationContext,
  sessionId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function queueLeadEnrichment(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function reviewLeadEnrichment(
  client: QueryClient,
  context: CrmFoundationContext,
  reviewId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getLeadAcquisitionDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function recordCrmLeadAcquisitionAcceptance(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmLeadAcquisitionReadiness(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
