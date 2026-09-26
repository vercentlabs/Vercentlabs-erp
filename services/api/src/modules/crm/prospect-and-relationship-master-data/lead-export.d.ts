import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export const LEAD_EXPORT_JOB_TYPE: string;
export const LEAD_EXPORT_COLUMNS: ReadonlyArray<{ key: string; label: string }>;

export function enqueueCrmLeadExportJob(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: { filters?: Record<string, unknown> },
): Promise<Record<string, unknown>>;

export function getCrmLeadExportJob(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
): Promise<Record<string, unknown>>;

export function buildCrmLeadExportCsv(
  client: QueryClient,
  context: CrmFoundationContext,
  filters: Record<string, unknown>,
): Promise<{ csv: string; rowCount: number; truncated: boolean }>;

export function completeCrmLeadExportJob(
  client: QueryClient,
  jobId: string,
  organizationId: string,
  result: { csv: string; rowCount: number; truncated: boolean },
  options?: { storage?: unknown; env?: Record<string, string | undefined> },
): Promise<{ rowCount: number; truncated: boolean; columns: string[]; generatedAt: string; expiresAt: string; artifactId: string; fileName: string }>;

export function readCrmLeadExportArtifact(
  client: QueryClient,
  context: CrmFoundationContext,
  jobId: string,
  options?: { storage?: unknown; env?: Record<string, string | undefined> },
): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; contentSha256: string | null; body: Buffer }>;
