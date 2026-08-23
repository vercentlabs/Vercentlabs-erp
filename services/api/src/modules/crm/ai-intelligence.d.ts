import type { QueryClient } from "../../index.js";
export type CrmAiContext = { organizationId: string; userId: string };
export const CRM_AI_INTELLIGENCE_CAPABILITY_IDS: readonly string[];
export class CrmAiIntelligenceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmAiHash(value: unknown): string;
export function rankNextBestActions(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function calculateRelationshipIntelligence(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function redactAssistantContext(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function buildGenerativeAssistantDraft(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function calculateDealRisk(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function validateAiFeedback(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function createNextBestAction(
  client: QueryClient,
  context: CrmAiContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function captureRelationshipIntelligence(
  client: QueryClient,
  context: CrmAiContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function createAssistantDraft(
  client: QueryClient,
  context: CrmAiContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function captureDealRisk(
  client: QueryClient,
  context: CrmAiContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordAiFeedback(
  client: QueryClient,
  context: CrmAiContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmAiDashboard(
  client: QueryClient,
  context: CrmAiContext,
): Promise<Record<string, unknown>>;
export function recordCrmAiAcceptance(
  client: QueryClient,
  context: CrmAiContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmAiReadiness(
  client: QueryClient,
  context: CrmAiContext,
  commitSha?: string,
): Promise<Record<string, unknown>>;
