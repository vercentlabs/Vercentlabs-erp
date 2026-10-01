"use client";

import type {
  LeadAssigneeAvailability,
  LeadAssignmentFallback,
  LeadAssignmentPolicy,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class AssignmentPolicyApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(AssignmentPolicyApiError);

export async function listLeadAssignmentPolicies(): Promise<{
  rows: LeadAssignmentPolicy[];
}> {
  return request("/api/crm/lead-assignment-policies");
}
export async function createLeadAssignmentPolicy(
  input: Record<string, unknown>,
): Promise<{ record: LeadAssignmentPolicy }> {
  return request("/api/crm/lead-assignment-policies", {
    method: "POST",
    json: input,
  });
}
export async function updateLeadAssignmentPolicy(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: LeadAssignmentPolicy }> {
  return request(`/api/crm/lead-assignment-policies/${id}`, {
    method: "PATCH",
    json: { ...input, expectedUpdatedAt },
  });
}
export async function setLeadAssignmentPolicyStatus(
  id: string,
  status: "active" | "inactive",
  expectedUpdatedAt: string,
): Promise<{ record: LeadAssignmentPolicy }> {
  return request(`/api/crm/lead-assignment-policies/${id}`, {
    method: "POST",
    json: { status, expectedUpdatedAt },
  });
}
export async function archiveLeadAssignmentPolicy(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: LeadAssignmentPolicy }> {
  const response = await fetch(
    `/api/crm/lead-assignment-policies/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export type AssignmentExplanation = {
  userId: string;
  name: string | null;
  eligible: boolean;
  reasons: string[];
};
export async function explainAssignmentPolicy(
  id: string,
  companyId?: string,
  branchId?: string,
): Promise<{ rows: AssignmentExplanation[] }> {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (branchId) params.set("branchId", branchId);
  const query = params.toString();
  const response = await fetch(
    `/api/crm/lead-assignment-policies/${id}/explain${query ? `?${query}` : ""}`,
  );
  return parseResponse(response);
}

// F005 gap-closure — fallback owner (checked once, last, after every
// active policy above has had its chance) and out-of-office availability
// windows (consulted only for automatic assignment). Both backends already
// existed and were already read by the live engine; this is the first
// client surface for either.
export async function getLeadAssignmentFallback(): Promise<{
  record: LeadAssignmentFallback;
}> {
  return request("/api/crm/lead-assignment-fallback");
}
export async function setLeadAssignmentFallback(
  userId: string | null,
): Promise<{ record: LeadAssignmentFallback }> {
  return request("/api/crm/lead-assignment-fallback", {
    method: "POST",
    json: { userId },
  });
}
export async function listLeadAssigneeAvailability(): Promise<{
  rows: LeadAssigneeAvailability[];
}> {
  return request("/api/crm/lead-assignee-availability");
}
export async function setLeadAssigneeAvailability(input: {
  userId: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
}): Promise<{ record: LeadAssigneeAvailability }> {
  return request("/api/crm/lead-assignee-availability", {
    method: "POST",
    json: input,
  });
}
export async function clearLeadAssigneeAvailability(
  id: string,
): Promise<{ id: string }> {
  return request(`/api/crm/lead-assignee-availability/${id}`, {
    method: "DELETE",
  });
}
