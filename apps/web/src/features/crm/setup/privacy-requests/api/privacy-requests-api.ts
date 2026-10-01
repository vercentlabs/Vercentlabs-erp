"use client";

import type {
  ConsentEvent,
  CrmListResponse,
  PrivacyRequest,
  PrivacyRequestPreview,
  PrivacyRetentionDashboard,
  PrivacyRetentionPolicy,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class PrivacyApiError extends CrmApiError {}

const { request } = crmApiClient(PrivacyApiError);

// privacy-requests/consent-events reuse the generic /api/crm/[resource]
// boundary for list/create (see resource-permissions.ts's crm.privacy.
// manage entry); preview/execute/retention are bespoke actions with their
// own routes, since they are not plain CRUD.
export async function listPrivacyRequests(
  status?: string,
): Promise<CrmListResponse<PrivacyRequest>> {
  const query =
    status && status !== "all"
      ? `?status=${encodeURIComponent(status)}&limit=100`
      : "?limit=100";
  return request(`/api/crm/privacy-requests${query}`);
}

export async function createPrivacyRequest(
  input: Record<string, unknown>,
): Promise<{ record: PrivacyRequest }> {
  return request("/api/crm/privacy-requests", { method: "POST", json: input });
}

export async function previewPrivacyRequest(
  id: string,
): Promise<{ preview: PrivacyRequestPreview }> {
  return request(`/api/crm/privacy-requests/${id}/preview`);
}

export async function executePrivacyRequest(
  id: string,
  input: Record<string, unknown>,
): Promise<{
  run: Record<string, unknown>;
  exportPayload: Record<string, unknown> | null;
}> {
  return request(`/api/crm/privacy-requests/${id}/execute`, {
    method: "POST",
    json: input,
  });
}

export async function getPrivacyRetentionDashboard(): Promise<{
  dashboard: PrivacyRetentionDashboard;
}> {
  return request("/api/crm/privacy/retention");
}

export async function updatePrivacyRetentionPolicy(
  id: string,
  input: Record<string, unknown>,
): Promise<{ policy: PrivacyRetentionPolicy }> {
  return request(`/api/crm/privacy/retention/${id}`, {
    method: "PATCH",
    json: input,
  });
}

export async function runPrivacyRetentionNow(): Promise<{
  policies: number;
  processed: number;
}> {
  return request("/api/crm/privacy/retention/run", { method: "POST" });
}

export async function listConsentEvents(
  leadId: string,
): Promise<CrmListResponse<ConsentEvent>> {
  return request(
    `/api/crm/consent-events?leadId=${encodeURIComponent(leadId)}&limit=50`,
  );
}

export async function createConsentEvent(
  input: Record<string, unknown>,
): Promise<{ record: ConsentEvent }> {
  return request("/api/crm/consent-events", { method: "POST", json: input });
}
