"use client";

import type {
  CrmCustomFieldDefinition,
  CrmCustomObjectDefinition,
  CrmListResponse,
  CrmTag,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class SettingsApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(SettingsApiError);

// All three resources reuse the generic /api/crm/[resource] boundary — no
// dedicated routes exist or are needed (see resource-permissions.ts for
// the crm.settings.manage gate applied to all three).
export async function listTags(): Promise<CrmListResponse<CrmTag>> {
  return request("/api/crm/tags?limit=100");
}
export async function createTag(
  input: Record<string, unknown>,
): Promise<{ record: CrmTag }> {
  return request("/api/crm/tags", { method: "POST", json: input });
}
export async function archiveTag(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: CrmTag }> {
  const response = await fetch(
    `/api/crm/tags/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export async function listCustomObjectDefinitions(): Promise<
  CrmListResponse<CrmCustomObjectDefinition>
> {
  return request("/api/crm/custom-object-definitions?limit=100");
}
export async function createCustomObjectDefinition(
  input: Record<string, unknown>,
): Promise<{ record: CrmCustomObjectDefinition }> {
  return request("/api/crm/custom-object-definitions", {
    method: "POST",
    json: input,
  });
}
export async function archiveCustomObjectDefinition(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: CrmCustomObjectDefinition }> {
  const response = await fetch(
    `/api/crm/custom-object-definitions/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export async function listCustomFieldDefinitions(): Promise<
  CrmListResponse<CrmCustomFieldDefinition>
> {
  return request("/api/crm/custom-field-definitions?limit=200");
}
export async function createCustomFieldDefinition(
  input: Record<string, unknown>,
): Promise<{ record: CrmCustomFieldDefinition }> {
  return request("/api/crm/custom-field-definitions", {
    method: "POST",
    json: input,
  });
}
export async function archiveCustomFieldDefinition(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: CrmCustomFieldDefinition }> {
  const response = await fetch(
    `/api/crm/custom-field-definitions/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}
