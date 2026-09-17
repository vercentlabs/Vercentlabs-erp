"use client";

import type { Meeting, MeetingListFilters, MeetingListResponse } from "../types";

export class MeetingApiError extends Error {
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
    throw new MeetingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listMeetings(filters: MeetingListFilters): Promise<MeetingListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/meetings?${params.toString()}`);
  return parseResponse(response);
}

export async function createMeeting(input: Record<string, unknown>): Promise<{ record: Meeting }> {
  const response = await fetch("/api/crm/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateMeeting(id: string, input: Record<string, unknown>): Promise<{ record: Meeting }> {
  const response = await fetch(`/api/crm/meetings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

async function action(id: string, path: string, input: Record<string, unknown> = {}): Promise<{ record: Meeting }> {
  const response = await fetch(`/api/crm/meetings/${id}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function getMeeting(id: string): Promise<{ record: Meeting }> {
  const response = await fetch(`/api/crm/meetings/${id}`);
  return parseResponse(response);
}

export const startMeeting = (id: string, expectedUpdatedAt?: string) => action(id, "start", { expectedUpdatedAt });
export const completeMeeting = (id: string, outcomeCode: string, outcome?: string, expectedUpdatedAt?: string) =>
  action(id, "complete", { outcomeCode, outcome, expectedUpdatedAt });
export const cancelMeeting = (id: string, expectedUpdatedAt?: string) => action(id, "cancel", { expectedUpdatedAt });
