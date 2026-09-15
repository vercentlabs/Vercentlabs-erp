"use client";

import type { LeadSource, LeadSourceListResponse } from "../types";

export class LeadSourceApiError extends Error {
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
    throw new LeadSourceApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listLeadSources(): Promise<LeadSourceListResponse> {
  const response = await fetch("/api/crm/lead-sources");
  return parseResponse(response);
}

export async function createLeadSource(input: Record<string, unknown>): Promise<{ record: LeadSource }> {
  const response = await fetch("/api/crm/lead-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function updateLeadSource(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: LeadSource }> {
  const response = await fetch(`/api/crm/lead-sources/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}

export async function setLeadSourceActive(id: string, active: boolean, expectedUpdatedAt: string): Promise<{ record: LeadSource }> {
  const response = await fetch(`/api/crm/lead-sources/${id}/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active, expectedUpdatedAt }) });
  return parseResponse(response);
}
