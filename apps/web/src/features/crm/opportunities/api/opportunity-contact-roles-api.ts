"use client";

// Same vocabulary as contact-relationships-api.ts's STAKEHOLDER_ROLES — see
// opportunity-contacts.js's own comment on why this is duplicated rather
// than imported (separate CRM capabilities on the backend; here it's simply
// two independent frontend feature folders).
export const OPPORTUNITY_CONTACT_ROLES = ["economic_buyer", "decision_maker", "champion", "influencer", "user", "blocker", "procurement", "legal", "technical", "other"] as const;
export type OpportunityContactRole = (typeof OPPORTUNITY_CONTACT_ROLES)[number];

export type OpportunityContactRoleRow = {
  id: string;
  opportunityId: string;
  contactId: string;
  role: OpportunityContactRole | null;
  isPrimary: boolean;
  notes: string | null;
  status: "active" | "inactive";
  firstName: string;
  lastName: string | null;
  designation: string | null;
  contactStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type ContactOpportunityRoleRow = {
  id: string;
  opportunityId: string;
  contactId: string;
  role: OpportunityContactRole | null;
  isPrimary: boolean;
  opportunityName: string;
  opportunityStatus: string;
  amount: number | string | null;
  currencyCode: string | null;
};

export class OpportunityContactRoleApiError extends Error {
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
    throw new OpportunityContactRoleApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listOpportunityContactRoles(opportunityId: string): Promise<{ rows: OpportunityContactRoleRow[] }> {
  const response = await fetch(`/api/crm/opportunities/${opportunityId}/contact-roles`);
  return parseResponse(response);
}
export async function addOpportunityContactRole(opportunityId: string, input: Record<string, unknown>): Promise<{ rows: OpportunityContactRoleRow[] }> {
  const response = await fetch(`/api/crm/opportunities/${opportunityId}/contact-roles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateOpportunityContactRole(opportunityId: string, roleId: string, input: Record<string, unknown>): Promise<{ rows: OpportunityContactRoleRow[] }> {
  const response = await fetch(`/api/crm/opportunities/${opportunityId}/contact-roles/${roleId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function setPrimaryOpportunityContactRole(opportunityId: string, roleId: string): Promise<{ rows: OpportunityContactRoleRow[] }> {
  const response = await fetch(`/api/crm/opportunities/${opportunityId}/contact-roles/${roleId}/primary`, { method: "POST" });
  return parseResponse(response);
}
export async function removeOpportunityContactRole(opportunityId: string, roleId: string, promoteRoleId?: string): Promise<{ rows: OpportunityContactRoleRow[] }> {
  const params = promoteRoleId ? `?promoteRoleId=${encodeURIComponent(promoteRoleId)}` : "";
  const response = await fetch(`/api/crm/opportunities/${opportunityId}/contact-roles/${roleId}${params}`, { method: "DELETE" });
  return parseResponse(response);
}
