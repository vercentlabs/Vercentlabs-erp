"use client";

import type { Communication, CommunicationListFilters, CommunicationListResponse } from "../types";

export class CommunicationApiError extends Error {
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
    throw new CommunicationApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// Reuses the generic /api/crm/[resource] boundary ("communications" is a
// real CRM_RESOURCE_KEYS entry) rather than a bespoke route — see types.ts
// for the content-visibility contract this implies.
export async function listCommunications(filters: CommunicationListFilters): Promise<CommunicationListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/communications?${params.toString()}`);
  return parseResponse(response);
}

export async function getCommunication(id: string): Promise<{ record: Communication }> {
  const response = await fetch(`/api/crm/communications/${id}`);
  return parseResponse(response);
}
