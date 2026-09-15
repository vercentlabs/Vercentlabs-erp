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

export async function previewLeadImportRequest(input: {
  rows: Record<string, unknown>[];
  fieldMapping: Record<string, string>;
  fileName: string;
  duplicateStrategy: string;
}): Promise<LeadImportPreviewResult> {
  const response = await fetch("/api/crm/leads/import/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
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
