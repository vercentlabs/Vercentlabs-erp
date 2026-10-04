"use client";

// Browser client for Won / Lost Reasons: the reason lists and their settings,
// an opportunity's close history, correcting a close reason, and the win /
// loss report. Closing itself is the opportunity's Mark won / Mark lost call.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class CloseReasonApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(CloseReasonApiError, "body");

export type CloseOutcome = "won" | "lost";
export type CloseReason = {
  id: string; code: string; name: string; outcome: CloseOutcome; category: string; sequence: number; active: boolean;
  requiresNotes: boolean; capturesCompetitor: boolean; requiresCompetitor: boolean; offersFollowUp: boolean; linksDuplicate: boolean; useCount?: number;
};
export type CloseReasonInput = {
  outcome?: CloseOutcome; name?: string; category?: string;
  requiresNotes?: boolean; capturesCompetitor?: boolean; requiresCompetitor?: boolean; offersFollowUp?: boolean; linksDuplicate?: boolean;
};
export type OpportunityCloseEvent = {
  id: string; outcome: CloseOutcome; reasonId: string | null; reasonName: string | null; notes: string | null; competitorName: string | null;
  duplicateOfOpportunityId: string | null; duplicateOfCode: string | null; finalStageName: string | null; estimatedValue: number | null; finalValue: number | null;
  winningQuotationId: string | null; winningQuotationNumber: string | null; actualCloseDate: string; closedByName: string | null; closedAt: string;
  correctedAt: string | null; correctedByName: string | null; correctionReason: string | null;
  reopenedAt: string | null; reopenedByName: string | null; reopenReason: string | null; reopenedToStageName: string | null;
};
export type WinLossReasonShare = { reasonId: string | null; name: string; count: number; share: number; value: number };
export type WinLossReport = {
  period: { from: string; to: string }; groupBy: string; groupLabel: string;
  totals: { won: number; lost: number; wonValue: number; lostValue: number; winRate: number | null; topLostReason: string | null };
  wonReasons: WinLossReasonShare[];
  lostReasons: WinLossReasonShare[];
  groups: Array<{ key: string; label: string; won: number; lost: number; wonValue: number; lostValue: number; winRate: number | null; topLostReason: string | null; topWonReason: string | null }>;
};

export const CLOSE_REASON_CATEGORIES = [
  { value: "price", label: "Commercial" }, { value: "competition", label: "Competition" }, { value: "fit", label: "Product and fit" }, { value: "budget", label: "Budget" },
  { value: "timing", label: "Timing" }, { value: "no_response", label: "Customer" }, { value: "duplicate", label: "Duplicate" }, { value: "other", label: "Other" },
];
export const WIN_LOSS_GROUPS = [
  { value: "reason", label: "Reason" }, { value: "owner", label: "Owner" }, { value: "team", label: "Team" }, { value: "source", label: "Lead source" },
  { value: "product", label: "Product" }, { value: "account", label: "Account" }, { value: "industry", label: "Industry" }, { value: "stage", label: "Final stage" },
  { value: "month", label: "Close month" },
];

const BASE = "/api/crm/close-reasons";
export const listCloseReasons = (options: { outcome?: CloseOutcome; includeInactive?: boolean } = {}) => {
  const search = new URLSearchParams();
  if (options.outcome) search.set("outcome", options.outcome);
  if (options.includeInactive) search.set("includeInactive", "1");
  return request<{ reasons: CloseReason[] }>(`${BASE}${search.size ? `?${search}` : ""}`).then((result) => result.reasons);
};
export const createCloseReason = (input: CloseReasonInput) => request<{ reason: CloseReason }>(BASE, { method: "POST", json: input }).then((result) => result.reason);
export const updateCloseReason = (id: string, input: CloseReasonInput) => request<{ reason: CloseReason }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.reason);
export const setCloseReasonActive = (id: string, active: boolean) => request<{ id: string; active: boolean }>(`${BASE}/${id}/status`, { method: "POST", json: { active } });
export const reorderCloseReasons = (outcome: CloseOutcome, reasonIds: string[]) =>
  request<{ reasons: CloseReason[] }>(`${BASE}/reorder`, { method: "POST", json: { outcome, reasonIds } }).then((result) => result.reasons);
export const deleteCloseReason = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });

export const listOpportunityCloseHistory = (opportunityId: string) =>
  request<{ history: OpportunityCloseEvent[] }>(`/api/crm/opportunities/${opportunityId}/close-history`).then((result) => result.history);
export const correctOpportunityCloseReason = (opportunityId: string, input: { reasonId: string; notes?: string; competitorName?: string; correctionReason: string }) =>
  request<{ status: string; reasonId: string }>(`/api/crm/opportunities/${opportunityId}/close-reason`, { method: "POST", json: input });
export const getWinLossReport = (params: { from?: string; to?: string; groupBy?: string; ownerId?: string; teamId?: string; sourceId?: string } = {}) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value) as Array<[string, string]>).toString();
  return request<{ report: WinLossReport }>(`/api/crm/opportunities/win-loss-report${search ? `?${search}` : ""}`).then((result) => result.report);
};

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
