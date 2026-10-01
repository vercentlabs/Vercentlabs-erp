"use client";

import type {
  Communication,
  CommunicationListFilters,
  CommunicationListResponse,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class CommunicationApiError extends CrmApiError {}

const { request } = crmApiClient(CommunicationApiError);

// Reuses the generic /api/crm/[resource] boundary ("communications" is a
// real CRM_RESOURCE_KEYS entry) rather than a bespoke route — see types.ts
// for the content-visibility contract this implies.
export async function listCommunications(
  filters: CommunicationListFilters,
): Promise<CommunicationListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return request(`/api/crm/communications?${params.toString()}`);
}

export async function getCommunication(
  id: string,
): Promise<{ record: Communication }> {
  return request(`/api/crm/communications/${id}`);
}
