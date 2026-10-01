"use client";

import type {
  LeadExportJob,
  LeadImportBatch,
  LeadImportPreviewResult,
  LeadImportRollbackResult,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class ImportExportApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(ImportExportApiError);

// The server parses the CSV (Shared Platform parser); the browser uploads the file.
export async function analyzeLeadImportRequest(file: File): Promise<{
  fileName: string;
  headers: string[];
  sample: Record<string, string>[];
  rowCount: number;
}> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/crm/leads/import/analyze", {
    method: "POST",
    body,
  });
  return parseResponse(response);
}

export async function previewLeadImportRequest(input: {
  file: File;
  fieldMapping: Record<string, string>;
  duplicateStrategy: string;
}): Promise<LeadImportPreviewResult> {
  const body = new FormData();
  body.set("file", input.file);
  body.set("fieldMapping", JSON.stringify(input.fieldMapping));
  body.set("duplicateStrategy", input.duplicateStrategy);
  const response = await fetch("/api/crm/leads/import/preview", {
    method: "POST",
    body,
  });
  return parseResponse(response);
}

// Small imports finish in the request; large ones return async: true and run
// as a background job (poll getLeadImportBatchRequest).
export async function commitLeadImportRequest(
  batchId: string,
): Promise<{ batch: LeadImportBatch; async: boolean; jobId?: string }> {
  return request(`/api/crm/leads/import/${batchId}/commit`, { method: "POST" });
}

export async function rollbackLeadImportRequest(
  batchId: string,
): Promise<LeadImportRollbackResult> {
  return request(`/api/crm/leads/import/${batchId}/rollback`, {
    method: "POST",
  });
}

// F021 gap-closure — the only way back to a completed batch used to be
// this screen's own local state, so leaving it stranded rollbackLeadImport
// as unreachable. This lists the requester's (or, for a view-all holder,
// every) recent batch so a past import stays visible and reversible.
export async function listLeadImportBatchesRequest(): Promise<{
  batches: LeadImportBatch[];
}> {
  return request("/api/crm/leads/import/batches");
}

// F021 Stage A2 §9. Export is now a real async, server-side job
// (tenant.background_jobs, job_type='crm.leads.export') — CSV generation,
// formula-injection neutralization (rowsToCsv/csvCell,
// @vercentlabs/reporting-engine) and row/field authorization all happen
// server-side via the SAME governed listCrmRecords("leads", ...) read the
// interactive list uses. Replaces the prior client-side "fetch every page
// then build CSV in the browser" approach, which used a local CSV writer
// with no formula-injection protection at all — a real, now-fixed gap.
export async function startLeadExportRequest(
  filters: Record<string, string | undefined> = {},
): Promise<{ job: LeadExportJob }> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters))
    if (value) cleaned[key] = value;
  return request("/api/crm/leads/export", {
    method: "POST",
    json: { filters: cleaned },
  });
}

export async function getLeadExportJobRequest(
  jobId: string,
): Promise<{ job: LeadExportJob }> {
  return request(`/api/crm/leads/export/${jobId}`);
}

export function leadExportDownloadUrl(jobId: string): string {
  return `/api/crm/leads/export/${jobId}/download`;
}

export async function getLeadImportBatchRequest(batchId: string): Promise<{
  batch: LeadImportBatch;
  progress: { processed: number; total: number; percent: number };
}> {
  return request(`/api/crm/leads/import/${batchId}`);
}

export function leadImportErrorsUrl(batchId: string) {
  return `/api/crm/leads/import/${batchId}/errors`;
}
