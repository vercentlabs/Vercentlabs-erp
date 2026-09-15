"use client";

import type { LeadAssignmentPolicy } from "../types";

export class AssignmentPolicyApiError extends Error {
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
    throw new AssignmentPolicyApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listLeadAssignmentPolicies(): Promise<{ rows: LeadAssignmentPolicy[] }> {
  const response = await fetch("/api/crm/lead-assignment-policies");
  return parseResponse(response);
}
export async function createLeadAssignmentPolicy(input: Record<string, unknown>): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch("/api/crm/lead-assignment-policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateLeadAssignmentPolicy(id: string, input: Record<string, unknown>): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function setLeadAssignmentPolicyStatus(id: string, status: "active" | "inactive"): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  return parseResponse(response);
}
export async function archiveLeadAssignmentPolicy(id: string): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}`, { method: "DELETE" });
  return parseResponse(response);
}
