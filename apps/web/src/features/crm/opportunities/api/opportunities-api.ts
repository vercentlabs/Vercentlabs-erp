"use client";

import type { CrmListResponse, Opportunity, OpportunityListFilters } from "../types";
import type { CrmTimelineEntry } from "@/features/crm/leads/api/leads-api";

export class OpportunityApiError extends Error {
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
    throw new OpportunityApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// Opportunities ARE a generic CRM_RESOURCE_KEYS resource (unlike Accounts/
// Contacts), so plain CRUD reuses the same /api/crm/[resource] boundary
// Leads uses — only stage/probability/timeline are dedicated actions.
export async function listOpportunities(filters: OpportunityListFilters): Promise<CrmListResponse<Opportunity>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/opportunities?${params.toString()}`);
  return parseResponse(response);
}

export async function getOpportunity(id: string): Promise<{ record: Opportunity }> {
  const response = await fetch(`/api/crm/opportunities/${id}`);
  return parseResponse(response);
}

export async function createOpportunity(input: Record<string, unknown>): Promise<{ record: Opportunity }> {
  const response = await fetch("/api/crm/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateOpportunity(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: Opportunity }> {
  const response = await fetch(`/api/crm/opportunities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, expectedUpdatedAt }),
  });
  return parseResponse(response);
}

export async function archiveOpportunity(id: string, expectedUpdatedAt: string): Promise<{ record: Opportunity }> {
  const response = await fetch(`/api/crm/opportunities/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function moveOpportunityStage(
  id: string,
  input: { stageId: string; note?: string | null; expectedUpdatedAt?: string; expectedStageId?: string | null; outcomeReasonId?: string | null; outcomeNotes?: string | null },
): Promise<{ record: Opportunity }> {
  const response = await fetch(`/api/crm/opportunities/${id}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateOpportunityProbability(
  id: string,
  input: { probability: number; note?: string | null; expectedUpdatedAt?: string; expectedProbability?: number | null },
): Promise<{ record: Opportunity }> {
  const response = await fetch(`/api/crm/opportunities/${id}/probability`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function getOpportunityTimeline(id: string, cursor?: string) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/crm/opportunities/${id}/timeline${params}`);
  return parseResponse<{ page: { rows: CrmTimelineEntry[]; hasMore: boolean; nextCursor: string | null } }>(response);
}
