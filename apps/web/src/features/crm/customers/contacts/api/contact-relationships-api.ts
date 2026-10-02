"use client";

import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export const RELATIONSHIP_TYPES = [
  "employment",
  "affiliated",
  "other",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export const STAKEHOLDER_ROLES = [
  "economic_buyer",
  "decision_maker",
  "champion",
  "influencer",
  "user",
  "blocker",
  "procurement",
  "legal",
  "technical",
  "other",
] as const;
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

export class ContactRelationshipApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(ContactRelationshipApiError);

export async function listContactRelationships(
  contactId: string,
): Promise<{ rows: ContactAccountRelationship[] }> {
  return request(`/api/crm/contacts/${contactId}/relationships`);
}
export async function addContactRelationship(
  contactId: string,
  input: Record<string, unknown>,
): Promise<{ rows: ContactAccountRelationship[] }> {
  return request(`/api/crm/contacts/${contactId}/relationships`, {
    method: "POST",
    json: input,
  });
}
export async function setPrimaryContactRelationship(
  contactId: string,
  relationshipId: string,
): Promise<{ rows: ContactAccountRelationship[] }> {
  const response = await fetch(
    `/api/crm/contacts/${contactId}/relationships/${relationshipId}/primary`,
    { method: "POST" },
  );
  return parseResponse(response);
}
export async function removeContactRelationship(
  contactId: string,
  relationshipId: string,
  promoteRelationshipId?: string,
): Promise<{ rows: ContactAccountRelationship[] }> {
  const params = promoteRelationshipId
    ? `?promoteRelationshipId=${encodeURIComponent(promoteRelationshipId)}`
    : "";
  const response = await fetch(
    `/api/crm/contacts/${contactId}/relationships/${relationshipId}${params}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export async function listAccountContactRelationships(
  accountId: string,
): Promise<{ rows: AccountContactRelationship[] }> {
  return request(`/api/crm/accounts/${accountId}/contact-relationships`);
}
