"use client";

import type { FollowUp, FollowUpListFilters, FollowUpListResponse } from "../types";

export class FollowUpApiError extends Error {
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
    throw new FollowUpApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listFollowUps(filters: FollowUpListFilters): Promise<FollowUpListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/follow-ups?${params.toString()}`);
  return parseResponse(response);
}

export async function createFollowUp(input: Record<string, unknown>): Promise<{ record: FollowUp }> {
  const response = await fetch("/api/crm/follow-ups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

async function action(id: string, path: string, input: Record<string, unknown> = {}): Promise<{ record: FollowUp }> {
  const response = await fetch(`/api/crm/follow-ups/${id}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export const snoozeFollowUp = (id: string, dueAt: string, expectedUpdatedAt?: string) => action(id, "snooze", { dueAt, expectedUpdatedAt });
export const completeFollowUp = (id: string, expectedUpdatedAt?: string) => action(id, "complete", { expectedUpdatedAt });
export const cancelFollowUp = (id: string, expectedUpdatedAt?: string) => action(id, "cancel", { expectedUpdatedAt });
