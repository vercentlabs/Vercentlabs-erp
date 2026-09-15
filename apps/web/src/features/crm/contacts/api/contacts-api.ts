"use client";

import type { Contact, ContactListFilters, ContactListResponse } from "../types";

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
