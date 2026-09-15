// tenant.crm_lost_reasons rows via the generic /api/crm/[resource]
// boundary ("lost-reasons" has no governance redirect, unlike "stages"/
// "sources" — confirmed by reading resource-mutation-service.js first).
export const LOST_REASON_CATEGORIES = [
  "price",
  "competition",
  "timing",
  "budget",
  "fit",
  "no_response",
  "duplicate",
  "other",
] as const;

export const OUTCOME_TYPES = ["won", "lost", "both"] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export type CrmOutcomeReason = {
  id: string;
  name: string;
  code: string;
  category: string;
  outcomeType: OutcomeType;
  sequence: number;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
