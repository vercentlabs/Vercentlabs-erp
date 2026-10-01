"use client";

import type { ContactOpportunityRoleRow } from "@/features/crm/opportunities/api/opportunity-contact-roles-api";
import type {
  Contact,
  ContactDuplicateMatch,
  ContactListFilters,
  ContactListResponse,
  ContactMergePreview,
} from "../types";
import { CrmApiErrorWithBody } from "../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../shared/http/crm-request.ts";

export class ContactApiError extends CrmApiErrorWithBody {}

const { request, parseResponse } = crmApiClient(ContactApiError, "body");

export async function listContacts(
  filters: ContactListFilters,
): Promise<ContactListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return request(`/api/crm/contacts?${params.toString()}`);
}

export async function getContact(id: string): Promise<{ record: Contact }> {
  return request(`/api/crm/contacts/${id}`);
}

export async function createContact(
  input: Record<string, unknown>,
): Promise<{ record: Contact }> {
  return request("/api/crm/contacts", { method: "POST", json: input });
}

export async function updateContact(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: Contact }> {
  return request(`/api/crm/contacts/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}

export async function archiveContact(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: Contact }> {
  const response = await fetch(
    `/api/crm/contacts/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

export async function reactivateContact(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: Contact }> {
  return request(`/api/crm/contacts/${id}/reactivate`, {
    method: "POST",
    json: { expectedUpdatedAt },
  });
}

// F003 Tranche F — mirrors the Account duplicates/merge client exactly;
// findContactDuplicates/mergeContactsGoverned were already real,
// already-tested backend services with zero frontend wiring.
export async function findContactDuplicates(
  input: Record<string, unknown>,
): Promise<{ duplicates: ContactDuplicateMatch[] }> {
  return request("/api/crm/contacts/duplicates", {
    method: "POST",
    json: { input },
  });
}

export async function previewContactMerge(
  sourceId: string,
  survivorId: string,
): Promise<ContactMergePreview> {
  return request("/api/crm/contacts/merge/preview", {
    method: "POST",
    json: { sourceId, survivorId },
  });
}
// F003 gap-closure — the Contact-side reverse view of Opportunity Contact
// Roles (opportunity-contacts.js), so a Contact's Deals tab shows every deal
// they hold a role on, not only the one where they're the legacy primary.
export async function listContactOpportunityRoles(
  contactId: string,
): Promise<{ rows: ContactOpportunityRoleRow[] }> {
  return request(`/api/crm/contacts/${contactId}/opportunity-roles`);
}

export async function mergeContacts(
  sourceId: string,
  survivorId: string,
  reason: string | null,
  fieldSelections: Record<string, "source" | "survivor">,
): Promise<{ record: Record<string, unknown> }> {
  return request("/api/crm/contacts/merge", {
    method: "POST",
    json: { sourceId, survivorId, reason, fieldSelections },
  });
}
