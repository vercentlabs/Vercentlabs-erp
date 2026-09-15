"use client";

import type { CrmListResponse, CrmOutcomeReason } from "../types";

export class OutcomeReasonApiError extends Error {
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
    throw new OutcomeReasonApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listOutcomeReasons(): Promise<CrmListResponse<CrmOutcomeReason>> {
  const response = await fetch("/api/crm/lost-reasons?limit=200");
  return parseResponse(response);
}
export async function createOutcomeReason(input: Record<string, unknown>): Promise<{ record: CrmOutcomeReason }> {
  const response = await fetch("/api/crm/lost-reasons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archiveOutcomeReason(id: string, expectedUpdatedAt: string): Promise<{ record: CrmOutcomeReason }> {
  const response = await fetch(`/api/crm/lost-reasons/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
