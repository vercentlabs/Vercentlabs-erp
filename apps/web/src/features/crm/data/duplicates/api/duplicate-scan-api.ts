"use client";

export type DuplicateScanEntityType = "lead" | "account" | "contact";

export type DuplicateScanJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "dead";
  jobType: string;
  entityType: DuplicateScanEntityType | null;
  attempts: number;
  maxAttempts: number;
  progress: { processed?: number; found?: number; percent?: number | null };
  resultManifest: { processed?: number; found?: number; percent?: number | null };
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

export class DuplicateScanApiError extends Error {
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
    throw new DuplicateScanApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function getLatestDuplicateScan(entityType: DuplicateScanEntityType): Promise<{ job: DuplicateScanJob }> {
  const response = await fetch(`/api/crm/duplicate-scan?entityType=${entityType}`);
  return parseResponse<{ job: DuplicateScanJob }>(response);
}

export async function startDuplicateScan(entityType: DuplicateScanEntityType): Promise<{ job: DuplicateScanJob }> {
  const response = await fetch("/api/crm/duplicate-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType }),
  });
  return parseResponse<{ job: DuplicateScanJob }>(response);
}

export async function getDuplicateScanJob(jobId: string): Promise<{ job: DuplicateScanJob }> {
  const response = await fetch(`/api/crm/duplicate-scan/${jobId}`);
  return parseResponse<{ job: DuplicateScanJob }>(response);
}

export async function listDuplicateScanMatches(jobId: string): Promise<{ rows: DuplicateScanMatch[] }> {
  const response = await fetch(`/api/crm/duplicate-scan/${jobId}/matches`);
  return parseResponse<{ rows: DuplicateScanMatch[] }>(response);
}
