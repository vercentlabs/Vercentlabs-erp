"use client";

import type { CrmListResponse, MeetingLink } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class MeetingLinkApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(MeetingLinkApiError);

// Reuses the generic /api/crm/[resource] boundary — meeting-links has no
// dedicated module (confirmed by grep before building this), just a
// resource-registry.js entry over tenant.crm_meeting_links.
export async function listMeetingLinks(): Promise<
  CrmListResponse<MeetingLink>
> {
  return request("/api/crm/meeting-links?limit=100");
}
export async function createMeetingLink(
  input: Record<string, unknown>,
): Promise<{ record: MeetingLink }> {
  return request("/api/crm/meeting-links", { method: "POST", json: input });
}
export async function updateMeetingLink(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: MeetingLink }> {
  return request(`/api/crm/meeting-links/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}
export async function archiveMeetingLink(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: MeetingLink }> {
  const response = await fetch(
    `/api/crm/meeting-links/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}
