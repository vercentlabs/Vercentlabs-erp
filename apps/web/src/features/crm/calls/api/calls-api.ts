"use client";

import type { Call, CallListFilters, CallListResponse } from "../types";

export class CallApiError extends Error {
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
    throw new CallApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listCalls(filters: CallListFilters): Promise<CallListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/calls?${params.toString()}`);
  return parseResponse(response);
}

export async function createCall(input: Record<string, unknown>): Promise<{ record: Call }> {
  const response = await fetch("/api/crm/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateCall(id: string, input: Record<string, unknown>): Promise<{ record: Call }> {
  const response = await fetch(`/api/crm/calls/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

async function action(id: string, path: string, input: Record<string, unknown> = {}): Promise<{ record: Call }> {
  const response = await fetch(`/api/crm/calls/${id}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export const startCall = (id: string, expectedUpdatedAt?: string) => action(id, "start", { expectedUpdatedAt });
export const completeCall = (id: string, outcomeCode: string, outcome?: string, expectedUpdatedAt?: string) =>
  action(id, "complete", { outcomeCode, outcome, expectedUpdatedAt });
export const cancelCall = (id: string, expectedUpdatedAt?: string) => action(id, "cancel", { expectedUpdatedAt });
