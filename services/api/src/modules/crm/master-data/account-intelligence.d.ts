import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export class CrmAccountIntelligenceError extends Error {
  readonly status: number;
  readonly code: string;
}
export function crmAccountIntelligenceHash(value: unknown): string;
export function previewContactMerge(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceId: string,
  survivorId: string,
): Promise<Record<string, unknown>>;
export function previewContactMergeForCaller(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceId: string,
  survivorId: string,
): Promise<Record<string, unknown>>;
export type MergeOptions = {
  fieldSelections?: Record<string, "source" | "survivor">;
  expectedSourceUpdatedAt?: string;
  expectedSurvivorUpdatedAt?: string;
};
export function mergeContactsGoverned(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceId: string,
  survivorId: string,
  reason?: string | null,
  options?: MergeOptions,
): Promise<Record<string, unknown>>;
export function resolveMergedEntity(
  client: QueryClient,
  context: CrmFoundationContext,
  entityType: "account" | "contact",
  sourceId: string,
): Promise<Record<string, unknown> | null>;
export function previewPrivacyRequest(
  client: QueryClient,
  context: CrmFoundationContext,
  requestId: string,
): Promise<Record<string, unknown>>;
export function executePrivacyRequest(
  client: QueryClient,
  context: CrmFoundationContext,
  requestId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getPrivacyRetentionDashboard(
  client: QueryClient,
  context: CrmFoundationContext,
): Promise<Record<string, unknown>>;
export function updatePrivacyRetentionPolicy(
  client: QueryClient,
  context: CrmFoundationContext,
  policyId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function runPrivacyRetention(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
