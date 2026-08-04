import type { QueryClient } from "../index.js";
export type CrmOfflineContext = {
  organizationId: string;
  userId: string;
  activeCompanyId?: string | null;
  activeBranchId?: string | null;
};
export const CRM_OFFLINE_CAPABILITY_IDS: readonly string[];
export class CrmOfflineSyncError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<Record<string, unknown>>;
}
export function crmOfflineHash(value: unknown): string;
export function createOfflineMutationId(
  input?: Record<string, unknown>,
): string;
export function calculateOfflineRetry(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function normalizeOfflineMutation(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function resolveOfflineConflict(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function compactOfflineChanges(
  changes: unknown,
): Array<Record<string, unknown>>;
export function applyOfflineMutation(
  client: QueryClient,
  context: CrmOfflineContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function applyOfflineBatch(
  client: QueryClient,
  context: CrmOfflineContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getOfflineChanges(
  client: QueryClient,
  context: CrmOfflineContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function resolveStoredOfflineConflict(
  client: QueryClient,
  context: CrmOfflineContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function recordCrmOfflineAcceptance(
  client: QueryClient,
  context: CrmOfflineContext,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function getCrmOfflineReadiness(
  client: QueryClient,
  context: CrmOfflineContext,
  commitSha?: string,
): Promise<Record<string, unknown>>;
