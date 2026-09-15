"use client";

import type { CrmListResponse, Lead, LeadListFilters } from "../types";

export class LeadApiError extends Error {
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
    throw new LeadApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listLeads(filters: LeadListFilters): Promise<CrmListResponse<Lead>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/leads?${params.toString()}`);
  return parseResponse<CrmListResponse<Lead>>(response);
}

export async function getLead(id: string): Promise<{ record: Lead }> {
  const response = await fetch(`/api/crm/leads/${id}`);
  return parseResponse<{ record: Lead }>(response);
}

export async function createLead(input: Record<string, unknown>): Promise<{ record: Lead }> {
  const response = await fetch("/api/crm/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<{ record: Lead }>(response);
}

export async function updateLead(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: Lead }> {
  const response = await fetch(`/api/crm/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, expectedUpdatedAt }),
  });
  return parseResponse<{ record: Lead }>(response);
}

export async function archiveLead(id: string, expectedUpdatedAt: string): Promise<{ record: Lead }> {
  const response = await fetch(`/api/crm/leads/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, {
    method: "DELETE",
  });
  return parseResponse<{ record: Lead }>(response);
}

export type LeadAssignmentResult = {
  lead: Lead;
  assignment: { changed: boolean; eventId?: string | null; previousOwnerUserId?: string | null; [key: string]: unknown };
};

export async function assignLead(
  id: string,
  input: { ownerUserId: string | null; reason?: string; expectedUpdatedAt: string; override?: boolean; overrideReason?: string },
): Promise<LeadAssignmentResult> {
  const response = await fetch(`/api/crm/leads/${id}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<LeadAssignmentResult>(response);
}

export type LeadStageTransitionResult = {
  changed: boolean;
  record: Lead;
  stage: { id: string; name: string; code: string; [key: string]: unknown };
  history: unknown[];
};

// Field name is `stageId` (or `stageCode`/`status`) — see
// transition-engine.js's `text(input.stageId || input.stageCode || input.status)`.
export async function transitionLeadStage(
  id: string,
  input: { stageId: string; note?: string; reasonCode?: string; expectedUpdatedAt?: string; requireVersion?: boolean },
): Promise<LeadStageTransitionResult> {
  const response = await fetch(`/api/crm/leads/${id}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<LeadStageTransitionResult>(response);
}

export async function convertLead(id: string, input: Record<string, unknown> = {}): Promise<{ result: unknown }> {
  const response = await fetch(`/api/crm/leads/${id}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<{ result: unknown }>(response);
}

// F008: findCrmDuplicates returns a lightweight match projection, not a
// full Lead — a `restricted` match deliberately carries no identifier or
// PII (see duplicate-search.js/lead-duplicates.js's `safeMatch`).
export type LeadDuplicateMatch =
  | { restricted: true }
  | {
      restricted?: false;
      id: string;
      code: string;
      name: string;
      fullName: string;
      company: string | null;
      companyName: string | null;
      recordStatus: string;
      lifecycleStage: string;
      status: string;
      classification: "exact" | "probable";
      matchScore: number;
      signals: string[];
    };

export async function findLeadDuplicates(input: Record<string, unknown>, excludeId?: string | null): Promise<{ duplicates: LeadDuplicateMatch[] }> {
  const response = await fetch("/api/crm/leads/duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, excludeId }),
  });
  return parseResponse<{ duplicates: LeadDuplicateMatch[] }>(response);
}

export async function mergeLead(targetId: string, sourceId: string): Promise<{ result: unknown }> {
  const response = await fetch(`/api/crm/leads/${targetId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId }),
  });
  return parseResponse<{ result: unknown }>(response);
}

export async function scheduleLeadFollowUp(
  id: string,
  input: { activityType: string; subject: string; description?: string | null; priority: string; assignedTo?: string | null; dueAt: string },
): Promise<{ activity: unknown; lead: Lead }> {
  const response = await fetch(`/api/crm/leads/${id}/follow-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<{ activity: unknown; lead: Lead }>(response);
}

// Envelope shape shared by every UNION branch in getCrmTimelinePage
// (timeline.js's buildBranch) — id/kind/subtype/title/occurredAt/status/
// actorUserId/createdBy, camelized. Not a full activity/note/communication
// row; each source's full detail lives on its own dedicated tab.
export type CrmTimelineEntry = {
  id: string;
  kind: "activity" | "communication" | "note" | "attachment";
  subtype: string | null;
  title: string | null;
  occurredAt: string;
  status: string | null;
  actorUserId: string | null;
  createdBy: string | null;
};

export async function getLeadTimeline(id: string, cursor?: string) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/crm/leads/${id}/timeline${params}`);
  return parseResponse<{ page: { rows: CrmTimelineEntry[]; hasMore: boolean; nextCursor: string | null } }>(response);
}

// Shape mirrors services/api's getCrmOptions (resource-options.js) — over
// 30 differently-shaped reference lists (companies/leadStages/users/tags/
// ...), so this is intentionally left as `any[]` per key rather than
// asserting one shared row shape across all of them.
export async function getCrmOptions(): Promise<{ options: Record<string, Array<Record<string, unknown>>> }> {
  const response = await fetch("/api/crm/options");
  return parseResponse(response);
}
