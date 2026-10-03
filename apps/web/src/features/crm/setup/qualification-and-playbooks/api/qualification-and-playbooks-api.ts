"use client";

import type {
  CrmListResponse,
  CrmPlaybook,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class SettingsApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(SettingsApiError);

// Both resources reuse the generic /api/crm/[resource] boundary
// (crm.settings.manage, RESOURCE_MANAGE_PERMISSIONS).

export async function listPlaybooks(): Promise<CrmListResponse<CrmPlaybook>> {
  return request("/api/crm/playbooks?limit=100");
}
export async function createPlaybook(
  input: Record<string, unknown>,
): Promise<{ record: CrmPlaybook }> {
  return request("/api/crm/playbooks", { method: "POST", json: input });
}
export async function archivePlaybook(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: CrmPlaybook }> {
  const response = await fetch(
    `/api/crm/playbooks/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}
