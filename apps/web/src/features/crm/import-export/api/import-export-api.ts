"use client";

import type { LeadImportBatch, LeadImportPreviewResult, LeadImportRollbackResult } from "../types";
import type { Lead } from "@/features/crm/leads/types";

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

// Export reuses the already-governed GET /api/crm/leads list read — the
// exact same organization/company/branch/owner scope and field
// projection a Lead list request already enforces — rather than a new
// backend export endpoint. Pages through in batches of 200 up to 5,000
// rows (matching the import side's own 5,000-row cap) and formats CSV
// entirely client-side from data the caller was already authorized to
// read.
export async function fetchAllLeadsForExport(filters: Record<string, string | undefined>): Promise<Lead[]> {
  const rows: Lead[] = [];
  let offset = 0;
  const pageSize = 200;
  const maximum = 5000;
  for (;;) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    const response = await fetch(`/api/crm/leads?${params.toString()}`);
    const payload = await parseResponse<{ rows: Lead[]; total: number }>(response);
    rows.push(...payload.rows);
    offset += pageSize;
    if (payload.rows.length < pageSize || rows.length >= maximum || offset >= payload.total) break;
  }
  return rows;
}
