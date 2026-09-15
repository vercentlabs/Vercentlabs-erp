"use client";

export const RELATIONSHIP_TYPES = ["employment", "affiliated", "other"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export const STAKEHOLDER_ROLES = ["economic_buyer", "decision_maker", "champion", "influencer", "user", "blocker", "procurement", "legal", "technical", "other"] as const;
export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];

// contact-relationships.js does not camelize every field consistently with
// the rest of the CRM backend's dto() convention — verified by reading its
// own dto() helper (identical snake->camel mapper) — so this IS camelCase,
// unlike account-intelligence.js/assignment-engine.js's raw rows.
export type ContactAccountRelationship = {
  id: string;
  contactId: string;
  partyId: string;
  relationshipType: RelationshipType;
  stakeholderRole: StakeholderRole | null;
  isPrimary: boolean;
  notes: string | null;
  status: "active" | "inactive";
  accountName: string;
  accountStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountContactRelationship = {
  id: string;
  contactId: string;
  partyId: string;
  relationshipType: RelationshipType;
  stakeholderRole: StakeholderRole | null;
  isPrimary: boolean;
  notes: string | null;
  status: "active" | "inactive";
  firstName: string;
  lastName: string | null;
  designation: string | null;
  contactStatus: string;
};

export class ContactRelationshipApiError extends Error {
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
    throw new ContactRelationshipApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listContactRelationships(contactId: string): Promise<{ rows: ContactAccountRelationship[] }> {
  const response = await fetch(`/api/crm/contacts/${contactId}/relationships`);
  return parseResponse(response);
}
export async function addContactRelationship(contactId: string, input: Record<string, unknown>): Promise<{ rows: ContactAccountRelationship[] }> {
  const response = await fetch(`/api/crm/contacts/${contactId}/relationships`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateContactRelationship(contactId: string, relationshipId: string, input: Record<string, unknown>): Promise<{ rows: ContactAccountRelationship[] }> {
  const response = await fetch(`/api/crm/contacts/${contactId}/relationships/${relationshipId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function setPrimaryContactRelationship(contactId: string, relationshipId: string): Promise<{ rows: ContactAccountRelationship[] }> {
  const response = await fetch(`/api/crm/contacts/${contactId}/relationships/${relationshipId}/primary`, { method: "POST" });
  return parseResponse(response);
}
export async function removeContactRelationship(contactId: string, relationshipId: string, promoteRelationshipId?: string): Promise<{ rows: ContactAccountRelationship[] }> {
  const params = promoteRelationshipId ? `?promoteRelationshipId=${encodeURIComponent(promoteRelationshipId)}` : "";
  const response = await fetch(`/api/crm/contacts/${contactId}/relationships/${relationshipId}${params}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function listAccountContactRelationships(accountId: string): Promise<{ rows: AccountContactRelationship[] }> {
  const response = await fetch(`/api/crm/accounts/${accountId}/contact-relationships`);
  return parseResponse(response);
}
