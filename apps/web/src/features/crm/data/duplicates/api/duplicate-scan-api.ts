"use client";

import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export type DuplicateScanEntityType = "lead" | "account" | "contact";

export type DuplicateScanJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "dead";
  jobType: string;
  entityType: DuplicateScanEntityType | null;
  attempts: number;
  maxAttempts: number;
  progress: { processed?: number; found?: number; percent?: number | null };
  resultManifest: {
    processed?: number;
    found?: number;
    percent?: number | null;
  };
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
} | null;

export type DuplicateScanMatch = {
  id: string;
  entityType: DuplicateScanEntityType;
  recordAId: string;
  recordAName: string | null;
  recordBId: string;
  recordBName: string | null;
  classification: "exact" | "probable";
  matchedSignals: string[];
  createdAt: string;
};

export class DuplicateScanApiError extends CrmApiError {}

const { request } = crmApiClient(DuplicateScanApiError);

export async function getLatestDuplicateScan(
  entityType: DuplicateScanEntityType,
): Promise<{ job: DuplicateScanJob }> {
  return request<{ job: DuplicateScanJob }>(
    `/api/crm/duplicate-scan?entityType=${entityType}`,
  );
}

export async function startDuplicateScan(
  entityType: DuplicateScanEntityType,
): Promise<{ job: DuplicateScanJob }> {
  return request<{ job: DuplicateScanJob }>("/api/crm/duplicate-scan", {
    method: "POST",
    json: { entityType },
  });
}

export async function getDuplicateScanJob(
  jobId: string,
): Promise<{ job: DuplicateScanJob }> {
  return request<{ job: DuplicateScanJob }>(`/api/crm/duplicate-scan/${jobId}`);
}

export async function listDuplicateScanMatches(
  jobId: string,
): Promise<{ rows: DuplicateScanMatch[] }> {
  return request<{ rows: DuplicateScanMatch[] }>(
    `/api/crm/duplicate-scan/${jobId}/matches`,
  );
}
