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
  input: { stageId: string; note?: string; reasonCode?: string; expectedUpdatedAt?: string; requireVersion?: boolean; overrideUsed?: boolean; overrideReason?: string },
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

// F022 pre-conversion review. Raw rows from findAccountDuplicates/
// findContactDuplicates — deliberately NOT camelized server-side (see
// duplicate-matching.js), so this stays snake_case to match the real
// response, not an assumed shape.
export type LeadConversionCandidate = {
  id: string;
  code?: string;
  display_name?: string;
  legal_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  party_id?: string | null;
  match_score: number;
  matched_signals: string[];
  classification: "exact" | "probable" | "none";
};

export async function getLeadConversionPreview(id: string): Promise<{ accountCandidates: LeadConversionCandidate[]; contactCandidates: LeadConversionCandidate[] }> {
  const response = await fetch(`/api/crm/leads/${id}/convert/preview`);
  return parseResponse(response);
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

// getCrmOptions moved to ../../shared/crm-options-api.ts — it's used by
// every CRM feature area (Leads/Accounts/Contacts/...), not just Leads.
export { getCrmOptions } from "../../shared/crm-options-api";

// F007: dwell/SLA context + transition history for the current stage.
export type LeadStageDwell = { enteredAt: string; elapsedHours: number; warningHours: number | null; breachHours: number | null; status: "ok" | "warning" | "breached" };
export type LeadStageHistoryEntry = { id: string; fromStageName: string; toStageName: string; source: string; note?: string | null; reasonCode: string | null; reasonLabel: string | null; actorName: string | null; createdAt: string; overrideUsed?: boolean; overrideReason?: string | null };

export async function getLeadStageDetail(id: string): Promise<{ dwell: LeadStageDwell; history: LeadStageHistoryEntry[]; canOverride: boolean }> {
  const response = await fetch(`/api/crm/leads/${id}/stage`);
  return parseResponse(response);
}

export type LeadStageTransitionEdge = { fromStageId: string; toStageId: string; reasonRequired: boolean; fromStageName: string; fromStageCode: string; toStageName: string; toStageCode: string };

export async function getLeadTransitionGraph(): Promise<{ transitions: LeadStageTransitionEdge[] }> {
  const response = await fetch("/api/crm/leads/transition-graph");
  return parseResponse(response);
}

export type LeadTransitionReason = { code: string; label: string };

export async function getLeadStageReasons(id: string, toStageId: string): Promise<{ reasons: LeadTransitionReason[] }> {
  const response = await fetch(`/api/crm/leads/${id}/stage/reasons?toStageId=${encodeURIComponent(toStageId)}`);
  return parseResponse(response);
}

// F006 qualification — independent axis from pipeline stage/record status.
export type LeadQualificationCriterion = { key: string; label: string; met: boolean; help?: string };
export type LeadQualification = {
  state: "not_reviewed" | "qualified" | "unqualified";
  reasonCode: string | null;
  reasonText: string | null;
  note: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  readiness: { ready: boolean; required: LeadQualificationCriterion[]; recommended: LeadQualificationCriterion[] };
  evaluatedAt: string;
  history: Array<{ id: string; previousState: string | null; newState: string; reasonCode: string | null; reasonText: string | null; note: string | null; decidedByName: string | null; overrideUsed: boolean; overrideReason: string | null; createdAt: string }>;
  reasons: LeadTransitionReason[];
  canOverride: boolean;
};

export async function getLeadQualificationDetail(id: string): Promise<{ qualification: LeadQualification }> {
  const response = await fetch(`/api/crm/leads/${id}/qualification`);
  return parseResponse(response);
}

export async function decideLeadQualification(
  id: string,
  input: { decision: "qualified" | "unqualified"; reasonCode?: string; reasonText?: string; note?: string; overrideUsed?: boolean; overrideReason?: string },
): Promise<{ changed: boolean; lead?: Lead; event?: unknown; qualification: LeadQualification }> {
  const response = await fetch(`/api/crm/leads/${id}/qualification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

// F027 scoring — read-only intelligence, never lifecycle authority.
export type LeadScoreExplanation = {
  id: string;
  code: string;
  full_name: string;
  score: number | null;
  lead_grade: string | null;
  score_calculated_at: string | null;
  score_explanation: { model?: { id: string; name: string; version: number }; thresholds?: Record<string, number>; contributions?: string; reason?: string } | null;
  content_hash: string | null;
  snapshot_at: string | null;
  // F027 — ML propensity, separate from the rule score.
  propensity_score: number | null;
  propensity_grade: string | null;
  propensity_calculated_at: string | null;
  propensity_explanation: { model?: { id: string; name: string; version: number }; contributions?: string } | null;
};

export async function getLeadScoreDetail(id: string): Promise<{ explanation: LeadScoreExplanation }> {
  const response = await fetch(`/api/crm/leads/${id}/score`);
  return parseResponse(response);
}

export type LeadScoreContribution = { ruleId: string | null; name: string; signalType: string; points: number; occurrences: number };

export async function recalculateLeadScore(id: string, reason?: string): Promise<{
  leadId: string;
  score: number;
  grade: string;
  contributions: LeadScoreContribution[];
  thresholds: { warm: number; hot: number; qualified: number };
  calculatedAt: string;
}> {
  const response = await fetch(`/api/crm/leads/${id}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return parseResponse(response);
}

export type LeadAttributionTouchpoint = {
  id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  channel: string;
  event_type: string;
  event_at: string;
  revenue: number;
  creditWeight: number;
};

export type LeadAttributionTimeline = {
  leadId: string;
  model: "first_touch" | "last_touch" | "linear" | "position_based" | "time_decay";
  touchpoints: LeadAttributionTouchpoint[];
  firstTouch: LeadAttributionTouchpoint | null;
  lastTouch: LeadAttributionTouchpoint | null;
  campaignCredit: Array<{ campaignId: string; campaignName: string | null; credit: number }>;
};

export async function getLeadAttribution(id: string): Promise<{ timeline: LeadAttributionTimeline }> {
  const response = await fetch(`/api/crm/leads/${id}/attribution`);
  return parseResponse(response);
}

export async function dismissLeadDuplicate(id: string, matchedLeadId: string, reason: string): Promise<{ result: unknown }> {
  const response = await fetch(`/api/crm/leads/${id}/duplicates/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchedLeadId, reason }),
  });
  return parseResponse(response);
}

// F029 governed bulk edit — only sourceId/nextFollowUpAt/priority/rating
// are supported (see lead-operations.js's normalizeLeadBulkChanges);
// ownership/stage/qualification remain single-record governed actions.
export type LeadBulkItemResult = { id: string; status: "applied" | "would_apply" | "conflict" | "skipped" | "failed"; updatedAt?: string; code?: string; message?: string };
export type LeadBulkSyncResult = { mode: "synchronous"; preview?: boolean; requested: number; updated: number; applied: number; would_apply?: number; conflict: number; skipped: number; failed: number; items: LeadBulkItemResult[] };
export type LeadBulkJobResult = { mode: "asynchronous"; deduped: boolean; job: { id: string; status: string; progress: Record<string, unknown>; resultManifest: Record<string, unknown> } };

export async function bulkUpdateLeads(
  ids: string[],
  changes: Record<string, unknown>,
  expectedVersions: Record<string, string>,
  idempotencyKey?: string,
  preview = false,
): Promise<LeadBulkSyncResult | LeadBulkJobResult> {
  const response = await fetch("/api/crm/leads/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, changes, expectedVersions, idempotencyKey, preview }),
  });
  return parseResponse(response);
}
