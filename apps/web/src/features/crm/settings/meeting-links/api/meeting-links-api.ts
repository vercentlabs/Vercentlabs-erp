"use client";

import type { CrmListResponse, MeetingLink } from "../types";

export class MeetingLinkApiError extends Error {
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
    throw new MeetingLinkApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// Reuses the generic /api/crm/[resource] boundary — meeting-links has no
// dedicated module (confirmed by grep before building this), just a
// resource-registry.js entry over tenant.crm_meeting_links.
export async function listMeetingLinks(): Promise<CrmListResponse<MeetingLink>> {
  const response = await fetch("/api/crm/meeting-links?limit=100");
  return parseResponse(response);
}
export async function createMeetingLink(input: Record<string, unknown>): Promise<{ record: MeetingLink }> {
  const response = await fetch("/api/crm/meeting-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateMeetingLink(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: MeetingLink }> {
  const response = await fetch(`/api/crm/meeting-links/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}
export async function archiveMeetingLink(id: string, expectedUpdatedAt: string): Promise<{ record: MeetingLink }> {
  const response = await fetch(`/api/crm/meeting-links/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
