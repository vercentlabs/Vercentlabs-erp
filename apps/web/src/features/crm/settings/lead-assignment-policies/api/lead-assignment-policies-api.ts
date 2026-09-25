"use client";

import type { LeadAssigneeAvailability, LeadAssignmentFallback, LeadAssignmentPolicy } from "../types";

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
export async function updateLeadAssignmentPolicy(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function setLeadAssignmentPolicyStatus(id: string, status: "active" | "inactive", expectedUpdatedAt: string): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function archiveLeadAssignmentPolicy(id: string, expectedUpdatedAt: string): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export type AssignmentExplanation = { userId: string; name: string | null; eligible: boolean; reasons: string[] };
export async function explainAssignmentPolicy(id: string, companyId?: string, branchId?: string): Promise<{ rows: AssignmentExplanation[] }> {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (branchId) params.set("branchId", branchId);
  const query = params.toString();
  const response = await fetch(`/api/crm/lead-assignment-policies/${id}/explain${query ? `?${query}` : ""}`);
  return parseResponse(response);
}

// F005 gap-closure — fallback owner (checked once, last, after every
// active policy above has had its chance) and out-of-office availability
// windows (consulted only for automatic assignment). Both backends already
// existed and were already read by the live engine; this is the first
// client surface for either.
export async function getLeadAssignmentFallback(): Promise<{ record: LeadAssignmentFallback }> {
  const response = await fetch("/api/crm/lead-assignment-fallback");
  return parseResponse(response);
}
export async function setLeadAssignmentFallback(userId: string | null): Promise<{ record: LeadAssignmentFallback }> {
  const response = await fetch("/api/crm/lead-assignment-fallback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
  return parseResponse(response);
}
export async function listLeadAssigneeAvailability(): Promise<{ rows: LeadAssigneeAvailability[] }> {
  const response = await fetch("/api/crm/lead-assignee-availability");
  return parseResponse(response);
}
export async function setLeadAssigneeAvailability(input: { userId: string; startsAt: string; endsAt: string; reason?: string }): Promise<{ record: LeadAssigneeAvailability }> {
  const response = await fetch("/api/crm/lead-assignee-availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function clearLeadAssigneeAvailability(id: string): Promise<{ id: string }> {
  const response = await fetch(`/api/crm/lead-assignee-availability/${id}`, { method: "DELETE" });
  return parseResponse(response);
}
