"use client";

import type { Contact, ContactDuplicateMatch, ContactListFilters, ContactListResponse, ContactMergePreview } from "../types";

export class ContactApiError extends Error {
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
    throw new ContactApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listContacts(filters: ContactListFilters): Promise<ContactListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/contacts?${params.toString()}`);
  return parseResponse(response);
}

export async function getContact(id: string): Promise<{ record: Contact }> {
  const response = await fetch(`/api/crm/contacts/${id}`);
  return parseResponse(response);
}

export async function createContact(input: Record<string, unknown>): Promise<{ record: Contact }> {
  const response = await fetch("/api/crm/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateContact(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: Contact }> {
  const response = await fetch(`/api/crm/contacts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, expectedUpdatedAt }),
  });
  return parseResponse(response);
}

export async function archiveContact(id: string, expectedUpdatedAt: string): Promise<{ record: Contact }> {
  const response = await fetch(`/api/crm/contacts/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function reactivateContact(id: string, expectedUpdatedAt: string): Promise<{ record: Contact }> {
  const response = await fetch(`/api/crm/contacts/${id}/reactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt }),
  });
  return parseResponse(response);
}

// F003 Tranche F — mirrors the Account duplicates/merge client exactly;
// findContactDuplicates/mergeContactsGoverned were already real,
// already-tested backend services with zero frontend wiring.
export async function findContactDuplicates(input: Record<string, unknown>): Promise<{ duplicates: ContactDuplicateMatch[] }> {
  const response = await fetch("/api/crm/contacts/duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  return parseResponse(response);
}

export async function previewContactMerge(sourceId: string, survivorId: string): Promise<ContactMergePreview> {
  const response = await fetch("/api/crm/contacts/merge/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, survivorId }),
  });
  return parseResponse(response);
}
export async function mergeContacts(
  sourceId: string,
  survivorId: string,
  reason: string | null,
  fieldSelections: Record<string, "source" | "survivor">,
): Promise<{ record: Record<string, unknown> }> {
  const response = await fetch("/api/crm/contacts/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, survivorId, reason, fieldSelections }),
  });
  return parseResponse(response);
}
