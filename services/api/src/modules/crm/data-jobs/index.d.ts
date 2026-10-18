import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type CrmDataJobEntity = "leads" | "accounts" | "contacts" | "opportunities";
export type CrmDataJob = {
  id: string;
  kind: "import" | "export";
  entity: CrmDataJobEntity;
  entityLabel: string;
  status: "queued" | "running" | "succeeded" | "failed";
  fileName: string | null;
  result: { rowCount?: number; fileName?: string; total?: number; created?: number; updated?: number; failed?: number; won?: number; lost?: number; errors?: Array<{ row: number; message: string }> };
  error: string | null;
  hasOutput: boolean;
  requestedByName: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export const CRM_DATA_JOB_TYPE: "crm.data_job.run";
export const BACKGROUND_IMPORT_ROW_LIMIT: number;
export const BACKGROUND_EXPORT_ROW_LIMIT: number;
export function requestCrmImportJob(client: QueryClient, context: CrmContext, input: {
  entity: CrmDataJobEntity; bytes: Uint8Array; fileName: string; mapping?: Record<string, string>; options?: Record<string, unknown>;
}, runtime?: { env?: NodeJS.ProcessEnv; storage?: unknown }): Promise<CrmDataJob>;
export function requestCrmExportJob(client: QueryClient, context: CrmContext, input: { entity: CrmDataJobEntity; filters?: Record<string, unknown> }): Promise<CrmDataJob>;
export function listCrmDataJobs(client: QueryClient, context: CrmContext, options?: { entity?: CrmDataJobEntity; limit?: number }): Promise<CrmDataJob[]>;
export function getCrmDataJob(client: QueryClient, context: CrmContext, jobId: string): Promise<CrmDataJob>;
export function readCrmDataJobOutput(client: QueryClient, context: CrmContext, jobId: string, runtime?: { storage?: unknown }): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; body: Buffer }>;
export function executeCrmDataJob(client: QueryClient, organizationId: string, payload: { crmDataJobId: string }, runtime?: { env?: NodeJS.ProcessEnv; storage?: unknown }): Promise<unknown>;
export function failCrmDataJob(client: QueryClient, organizationId: string, crmDataJobId: string, error: unknown): Promise<void>;
