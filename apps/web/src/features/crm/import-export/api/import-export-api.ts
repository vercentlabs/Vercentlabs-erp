"use client";

import type { LeadExportJob, LeadImportBatch, LeadImportPreviewResult, LeadImportRollbackResult } from "../types";

export class ImportExportApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new ImportExportApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// The server parses the CSV (Shared Platform parser); the browser uploads the file.
export async function analyzeLeadImportRequest(file: File): Promise<{ fileName: string; headers: string[]; sample: Record<string, string>[]; rowCount: number }> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/crm/leads/import/analyze", { method: "POST", body });
  return parseResponse(response);
}

export async function previewLeadImportRequest(input: { file: File; fieldMapping: Record<string, string>; duplicateStrategy: string }): Promise<LeadImportPreviewResult> {
  const body = new FormData();
  body.set("file", input.file);
  body.set("fieldMapping", JSON.stringify(input.fieldMapping));
  body.set("duplicateStrategy", input.duplicateStrategy);
  const response = await fetch("/api/crm/leads/import/preview", { method: "POST", body });
  return parseResponse(response);
}

export async function commitLeadImportRequest(batchId: string): Promise<{ batch: LeadImportBatch }> {
  const response = await fetch(`/api/crm/leads/import/${batchId}/commit`, { method: "POST" });
  return parseResponse(response);
}

export async function rollbackLeadImportRequest(batchId: string): Promise<LeadImportRollbackResult> {
  const response = await fetch(`/api/crm/leads/import/${batchId}/rollback`, { method: "POST" });
  return parseResponse(response);
}

// F021 gap-closure — the only way back to a completed batch used to be
// this screen's own local state, so leaving it stranded rollbackLeadImport
// as unreachable. This lists the requester's (or, for a view-all holder,
// every) recent batch so a past import stays visible and reversible.
export async function listLeadImportBatchesRequest(): Promise<{ batches: LeadImportBatch[] }> {
  const response = await fetch("/api/crm/leads/import/batches");
  return parseResponse(response);
}

// F021 Stage A2 §9. Export is now a real async, server-side job
// (tenant.background_jobs, job_type='crm.leads.export') — CSV generation,
// formula-injection neutralization (rowsToCsv/csvCell,
// @vercentlabs/reporting-engine) and row/field authorization all happen
// server-side via the SAME governed listCrmRecords("leads", ...) read the
// interactive list uses. Replaces the prior client-side "fetch every page
// then build CSV in the browser" approach, which used a local CSV writer
// with no formula-injection protection at all — a real, now-fixed gap.
export async function startLeadExportRequest(filters: Record<string, string | undefined> = {}): Promise<{ job: LeadExportJob }> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) if (value) cleaned[key] = value;
  const response = await fetch("/api/crm/leads/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters: cleaned }),
  });
  return parseResponse(response);
}

export async function getLeadExportJobRequest(jobId: string): Promise<{ job: LeadExportJob }> {
  const response = await fetch(`/api/crm/leads/export/${jobId}`);
  return parseResponse(response);
}

export function leadExportDownloadUrl(jobId: string): string {
  return `/api/crm/leads/export/${jobId}/download`;
}
