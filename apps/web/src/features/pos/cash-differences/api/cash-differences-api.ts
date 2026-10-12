"use client";

// POS Cash Difference (0106): difference cases (closing, opening and handover), their investigation, resolution and Finance treatment, and the
// shortage / overage report.
import { post, request } from "@/features/pos/shared/http";

export type CashDifference = {
  id: string; number: string; context: "OPENING" | "CLOSING" | "HANDOVER"; type: "SHORTAGE" | "OVERAGE"; currency: string; referenceAmount: string | null; countedAmount: string;
  differenceAmount: string; outlet: string; terminal: string | null; shiftId: string; shiftNumber: string; cashier: string | null; recounts: number; reasonCode: string | null;
  reasonLabel: string | null; reasonNote: string | null; approvedBy: string | null; relatedDifferenceId: string | null; relatedNumber: string | null;
  caseStatus: "OPEN" | "INVESTIGATING" | "RESOLVED"; assignedTo: string | null; notes: Array<{ note: string; at: string }>; resolutionType: string | null; resolutionNote: string | null;
  resolvedBy: string | null; financeStatus: "PENDING" | "RECORDED" | "NOT_REQUIRED"; financeTreatment: string | null; financeReference: string | null; createdAt: string;
};
export type DifferenceSummary = {
  from: string; to: string;
  totals: { shortages: string; shortageCount: number; overages: string; overageCount: number; net: string; average: string; discrepantShifts: number; approvedExceptions: number;
    unresolved: number; financePending: number; recounts: number };
  byContext: Array<{ key: string; label: string; shortages: string; overages: string; differences: number }>;
  byOutlet: Array<{ key: string; label: string; shortages: string; overages: string; differences: number }>;
  byCashier: Array<{ key: string; label: string; shortages: string; overages: string; differences: number }>;
};

export const RESOLUTION_LABEL: Record<string, string> = {
  SHORTAGE_ACCEPTED: "Actual shortage accepted", OVERAGE_ACCEPTED: "Actual overage accepted", CASH_MOVEMENT_CORRECTION: "Unrecorded cash movement corrected",
  CUSTODY_RESOLVED: "Custody transfer resolved with evidence", SAME_AS_LINKED_DIFFERENCE: "Same cash as the linked difference", OTHER: "Other",
};
export const TREATMENT_LABEL: Record<string, string> = { SHORTAGE_EXPENSE: "Cash shortage expense", OVERAGE_INCOME: "Cash overage", SUSPENSE: "Suspense", NO_ENTRY: "No entry" };
export const CONTEXT_LABEL: Record<string, string> = { CLOSING: "Closing", OPENING: "Opening (received from previous shift)", HANDOVER: "Handover (safe / manager)" };

export const listDifferences = (filters: Record<string, string> = {}) =>
  request<{ total: number; rows: CashDifference[] }>(`/cash-differences?${new URLSearchParams(filters).toString()}`);
export const differenceSummary = () => request<{ summary: DifferenceSummary }>("/cash-differences/summary").then((result) => result.summary);
export const investigateDifference = (id: string, input: { note: string }) =>
  post<{ difference: CashDifference }>(`/cash-differences/${id}/investigate`, input).then((result) => result.difference);
export const resolveDifference = (id: string, input: { resolutionType: string; resolutionNote: string; movementId?: string; relatedDifferenceId?: string }) =>
  post<{ difference: CashDifference }>(`/cash-differences/${id}/resolve`, input).then((result) => result.difference);
export const recordFinance = (id: string, input: { treatment: string; reference?: string }) =>
  post<{ difference: CashDifference }>(`/cash-differences/${id}/finance`, input).then((result) => result.difference);
