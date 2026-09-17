"use client";

import type { CrmCustomFieldDefinition, CrmCustomObjectDefinition, CrmListResponse, CrmTag } from "../types";

export class SettingsApiError extends Error {
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
    throw new SettingsApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// All three resources reuse the generic /api/crm/[resource] boundary — no
// dedicated routes exist or are needed (see resource-permissions.ts for
// the crm.settings.manage gate applied to all three).
export async function listTags(): Promise<CrmListResponse<CrmTag>> {
  const response = await fetch("/api/crm/tags?limit=100");
  return parseResponse(response);
}
export async function createTag(input: Record<string, unknown>): Promise<{ record: CrmTag }> {
  const response = await fetch("/api/crm/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archiveTag(id: string, expectedUpdatedAt: string): Promise<{ record: CrmTag }> {
  const response = await fetch(`/api/crm/tags/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function listCustomObjectDefinitions(): Promise<CrmListResponse<CrmCustomObjectDefinition>> {
  const response = await fetch("/api/crm/custom-object-definitions?limit=100");
  return parseResponse(response);
}
export async function createCustomObjectDefinition(input: Record<string, unknown>): Promise<{ record: CrmCustomObjectDefinition }> {
  const response = await fetch("/api/crm/custom-object-definitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archiveCustomObjectDefinition(id: string, expectedUpdatedAt: string): Promise<{ record: CrmCustomObjectDefinition }> {
  const response = await fetch(`/api/crm/custom-object-definitions/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function listCustomFieldDefinitions(): Promise<CrmListResponse<CrmCustomFieldDefinition>> {
  const response = await fetch("/api/crm/custom-field-definitions?limit=200");
  return parseResponse(response);
}
export async function createCustomFieldDefinition(input: Record<string, unknown>): Promise<{ record: CrmCustomFieldDefinition }> {
  const response = await fetch("/api/crm/custom-field-definitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archiveCustomFieldDefinition(id: string, expectedUpdatedAt: string): Promise<{ record: CrmCustomFieldDefinition }> {
  const response = await fetch(`/api/crm/custom-field-definitions/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
