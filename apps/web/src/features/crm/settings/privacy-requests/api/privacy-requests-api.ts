"use client";

import type { ConsentEvent, CrmListResponse, PrivacyRequest, PrivacyRequestPreview, PrivacyRetentionDashboard, PrivacyRetentionPolicy } from "../types";

export class PrivacyApiError extends Error {
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
    throw new PrivacyApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// privacy-requests/consent-events reuse the generic /api/crm/[resource]
// boundary for list/create (see resource-permissions.ts's crm.privacy.
// manage entry); preview/execute/retention are bespoke actions with their
// own routes, since they are not plain CRUD.
export async function listPrivacyRequests(status?: string): Promise<CrmListResponse<PrivacyRequest>> {
  const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}&limit=100` : "?limit=100";
  const response = await fetch(`/api/crm/privacy-requests${query}`);
  return parseResponse(response);
}

export async function createPrivacyRequest(input: Record<string, unknown>): Promise<{ record: PrivacyRequest }> {
  const response = await fetch("/api/crm/privacy-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function previewPrivacyRequest(id: string): Promise<{ preview: PrivacyRequestPreview }> {
  const response = await fetch(`/api/crm/privacy-requests/${id}/preview`);
  return parseResponse(response);
}

export async function executePrivacyRequest(id: string, input: Record<string, unknown>): Promise<{ run: Record<string, unknown>; exportPayload: Record<string, unknown> | null }> {
  const response = await fetch(`/api/crm/privacy-requests/${id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function getPrivacyRetentionDashboard(): Promise<{ dashboard: PrivacyRetentionDashboard }> {
  const response = await fetch("/api/crm/privacy/retention");
  return parseResponse(response);
}

export async function updatePrivacyRetentionPolicy(id: string, input: Record<string, unknown>): Promise<{ policy: PrivacyRetentionPolicy }> {
  const response = await fetch(`/api/crm/privacy/retention/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function runPrivacyRetentionNow(): Promise<{ policies: number; processed: number }> {
  const response = await fetch("/api/crm/privacy/retention/run", { method: "POST" });
  return parseResponse(response);
}

export async function listConsentEvents(leadId: string): Promise<CrmListResponse<ConsentEvent>> {
  const response = await fetch(`/api/crm/consent-events?leadId=${encodeURIComponent(leadId)}&limit=50`);
  return parseResponse(response);
}

export async function createConsentEvent(input: Record<string, unknown>): Promise<{ record: ConsentEvent }> {
  const response = await fetch("/api/crm/consent-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
