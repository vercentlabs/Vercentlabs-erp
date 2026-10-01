"use client";

import type {
  FollowUp,
  FollowUpHistoryEvent,
  FollowUpListFilters,
  FollowUpListResponse,
  FollowUpReminder,
} from "../types";
import { CrmApiError } from "../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../shared/http/crm-request.ts";

export class FollowUpApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(FollowUpApiError);

export async function listFollowUps(
  filters: FollowUpListFilters,
): Promise<FollowUpListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all")
      params.set(key, String(value));
  }
  return request(`/api/crm/follow-ups?${params.toString()}`);
}

export async function getFollowUp(id: string): Promise<{ record: FollowUp }> {
  return request(`/api/crm/follow-ups/${id}`);
}

export async function updateFollowUp(
  id: string,
  input: Record<string, unknown>,
): Promise<{ record: FollowUp }> {
  return request(`/api/crm/follow-ups/${id}`, { method: "PATCH", json: input });
}

export async function createFollowUp(
  input: Record<string, unknown>,
): Promise<{ record: FollowUp }> {
  return request("/api/crm/follow-ups", { method: "POST", json: input });
}

async function action(
  id: string,
  path: string,
  input: Record<string, unknown> = {},
): Promise<{ record: FollowUp }> {
  return request(`/api/crm/follow-ups/${id}/${path}`, {
    method: "POST",
    json: input,
  });
}

export const snoozeFollowUp = (
  id: string,
  dueAt: string,
  expectedUpdatedAt?: string,
) => action(id, "snooze", { dueAt, expectedUpdatedAt });
export const completeFollowUp = (id: string, expectedUpdatedAt?: string) =>
  action(id, "complete", { expectedUpdatedAt });
export const cancelFollowUp = (id: string, expectedUpdatedAt?: string) =>
  action(id, "cancel", { expectedUpdatedAt });

export async function listFollowUpReminders(
  id: string,
): Promise<{ rows: FollowUpReminder[] }> {
  return request(`/api/crm/follow-ups/${id}/reminders`);
}
export async function acknowledgeFollowUpReminder(
  id: string,
  reminderId: string,
): Promise<{ record: FollowUpReminder }> {
  const response = await fetch(
    `/api/crm/follow-ups/${id}/reminders/${reminderId}/acknowledge`,
    { method: "POST" },
  );
  return parseResponse(response);
}
export async function listFollowUpHistory(
  id: string,
): Promise<{ rows: FollowUpHistoryEvent[] }> {
  return request(`/api/crm/follow-ups/${id}/history`);
}
