"use client";

import type {
  Meeting,
  MeetingListFilters,
  MeetingListResponse,
} from "../types";
import { CrmApiError } from "../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../shared/http/crm-request.ts";

export class MeetingApiError extends CrmApiError {}

const { request } = crmApiClient(MeetingApiError);

export async function listMeetings(
  filters: MeetingListFilters,
): Promise<MeetingListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all")
      params.set(key, String(value));
  }
  return request(`/api/crm/meetings?${params.toString()}`);
}

export async function createMeeting(
  input: Record<string, unknown>,
): Promise<{ record: Meeting }> {
  return request("/api/crm/meetings", { method: "POST", json: input });
}

export async function updateMeeting(
  id: string,
  input: Record<string, unknown>,
): Promise<{ record: Meeting }> {
  return request(`/api/crm/meetings/${id}`, { method: "PATCH", json: input });
}

async function action(
  id: string,
  path: string,
  input: Record<string, unknown> = {},
): Promise<{ record: Meeting }> {
  return request(`/api/crm/meetings/${id}/${path}`, {
    method: "POST",
    json: input,
  });
}

export async function getMeeting(id: string): Promise<{ record: Meeting }> {
  return request(`/api/crm/meetings/${id}`);
}

export const startMeeting = (id: string, expectedUpdatedAt?: string) =>
  action(id, "start", { expectedUpdatedAt });
export const completeMeeting = (
  id: string,
  outcomeCode: string,
  outcome?: string,
  expectedUpdatedAt?: string,
) => action(id, "complete", { outcomeCode, outcome, expectedUpdatedAt });
export const cancelMeeting = (id: string, expectedUpdatedAt?: string) =>
  action(id, "cancel", { expectedUpdatedAt });

// F014 gap-closure — listCrmMeetingEvents (the immutable crm_meeting_events
// lifecycle ledger) existed, tested and exported, but had no route or
// frontend caller anywhere.
export type MeetingEvent = {
  id: string;
  activityId: string;
  eventType:
    | "scheduled"
    | "logged"
    | "booked"
    | "updated"
    | "rescheduled"
    | "started"
    | "completed"
    | "cancelled";
  previousStatus: string | null;
  nextStatus: string | null;
  locationType: "in_person" | "online" | "phone" | "other" | null;
  outcomeCode: "held" | "no_show" | null;
  durationSeconds: number | null;
  attendeeCount: number;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
};

export async function listMeetingEvents(
  id: string,
): Promise<{ rows: MeetingEvent[] }> {
  return request(`/api/crm/meetings/${id}/events`);
}
