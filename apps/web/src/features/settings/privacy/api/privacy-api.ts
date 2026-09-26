"use client";

export class PrivacyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new PrivacyApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type PrivacyRequest = {
  id: string;
  request_type: string;
  subject_reference: string;
  status: "received" | "verified" | "in_progress" | "completed" | "rejected" | "cancelled";
  requested_by: string | null;
  assigned_to: string | null;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type RetentionPolicy = {
  id: string;
  data_class: string;
  retention_days: number;
  legal_basis: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
  created_at: string;
  dataClassLabel: string;
  enforcement: "review_required" | "statutory_hold" | "automatic_expiry";
  enforcementNote: string;
};

export type PrivacyDataClass = { key: string; label: string; moduleKey: string; enforcement: RetentionPolicy["enforcement"]; note: string };

// Settings > Privacy and retention: the shared platform privacy authority
// (core/platform/privacy) via /api/privacy/*.
export async function listPrivacyRequests(): Promise<{ rows: PrivacyRequest[] }> {
  const response = await fetch("/api/privacy/requests");
  return parseResponse(response);
}
export async function createPrivacyRequest(input: { requestType: string; subjectReference: string; payload?: Record<string, unknown> }): Promise<{ record: PrivacyRequest }> {
  const response = await fetch("/api/privacy/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function transitionPrivacyRequest(id: string, status: string, resultPayload?: unknown): Promise<{ record: PrivacyRequest }> {
  const response = await fetch(`/api/privacy/requests/${id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, resultPayload }) });
  return parseResponse(response);
}
export async function listRetentionPolicies(): Promise<{ rows: RetentionPolicy[]; dataClasses: PrivacyDataClass[] }> {
  const response = await fetch("/api/privacy/retention-policies");
  return parseResponse(response);
}
export async function writeRetentionPolicy(input: { dataClass: string; retentionDays: number; legalBasis: string; effectiveFrom?: string }): Promise<{ record: RetentionPolicy }> {
  const response = await fetch("/api/privacy/retention-policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
