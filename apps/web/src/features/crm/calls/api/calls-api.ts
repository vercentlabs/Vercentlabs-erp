"use client";

import type { Call, CallListFilters, CallListResponse } from "../types";
import { CrmApiError } from "../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../shared/http/crm-request.ts";

export class CallApiError extends CrmApiError {}

const { request } = crmApiClient(CallApiError);

export async function listCalls(
  filters: CallListFilters,
): Promise<CallListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all")
      params.set(key, String(value));
  }
  return request(`/api/crm/calls?${params.toString()}`);
}

export async function createCall(
  input: Record<string, unknown>,
): Promise<{ record: Call }> {
  return request("/api/crm/calls", { method: "POST", json: input });
}

export async function updateCall(
  id: string,
  input: Record<string, unknown>,
): Promise<{ record: Call }> {
  return request(`/api/crm/calls/${id}`, { method: "PATCH", json: input });
}

async function action(
  id: string,
  path: string,
  input: Record<string, unknown> = {},
): Promise<{ record: Call }> {
  return request(`/api/crm/calls/${id}/${path}`, {
    method: "POST",
    json: input,
  });
}

export async function getCall(id: string): Promise<{ record: Call }> {
  return request(`/api/crm/calls/${id}`);
}

export const startCall = (id: string, expectedUpdatedAt?: string) =>
  action(id, "start", { expectedUpdatedAt });
export const completeCall = (
  id: string,
  outcomeCode: string,
  outcome?: string,
  expectedUpdatedAt?: string,
) => action(id, "complete", { outcomeCode, outcome, expectedUpdatedAt });
export const cancelCall = (id: string, expectedUpdatedAt?: string) =>
  action(id, "cancel", { expectedUpdatedAt });

// F013 gap-closure — listCrmCallEvents (the immutable crm_call_events
// lifecycle ledger) existed, tested and exported since call-operations.js
// was first written, but had no route or frontend caller anywhere.
export type CallEvent = {
  id: string;
  activityId: string;
  eventType:
    "scheduled" | "logged" | "updated" | "started" | "completed" | "cancelled";
  previousStatus: string | null;
  nextStatus: string | null;
  direction: "inbound" | "outbound" | null;
  outcomeCode: string | null;
  durationSeconds: number | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
};

export async function listCallEvents(
  id: string,
): Promise<{ rows: CallEvent[] }> {
  return request(`/api/crm/calls/${id}/events`);
}
