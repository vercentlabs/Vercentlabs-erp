"use client";

import type { CrmListResponse, CrmPlaybook, QualificationCriterion } from "../types";

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

// Both resources reuse the generic /api/crm/[resource] boundary
// (crm.settings.manage, RESOURCE_MANAGE_PERMISSIONS).
export async function listQualificationCriteria(): Promise<CrmListResponse<QualificationCriterion>> {
  const response = await fetch("/api/crm/qualification-criteria?limit=100");
  return parseResponse(response);
}
export async function createQualificationCriterion(input: Record<string, unknown>): Promise<{ record: QualificationCriterion }> {
  const response = await fetch("/api/crm/qualification-criteria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateQualificationCriterion(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: QualificationCriterion }> {
  const response = await fetch(`/api/crm/qualification-criteria/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function archiveQualificationCriterion(id: string, expectedUpdatedAt: string): Promise<{ record: QualificationCriterion }> {
  const response = await fetch(`/api/crm/qualification-criteria/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function listPlaybooks(): Promise<CrmListResponse<CrmPlaybook>> {
  const response = await fetch("/api/crm/playbooks?limit=100");
  return parseResponse(response);
}
export async function createPlaybook(input: Record<string, unknown>): Promise<{ record: CrmPlaybook }> {
  const response = await fetch("/api/crm/playbooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archivePlaybook(id: string, expectedUpdatedAt: string): Promise<{ record: CrmPlaybook }> {
  const response = await fetch(`/api/crm/playbooks/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
