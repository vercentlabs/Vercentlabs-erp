"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosReconciliation = {
  id: string;
  store_id: string | null;
  day_end_report_id: string | null;
  payment_method: string;
  reconciliation_number: string | null;
  expected_amount: string;
  settled_amount: string;
  variance_amount: string;
  fee_total: string;
  missing_count: number;
  duplicate_count: number;
  status: "draft" | "matched" | "variance" | "resolved";
  matched_by: string | null;
  matched_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
};
export type PosReconciliationDetail = PosReconciliation & { corrections: Array<{ id: string; correction_number: string; reason: string; created_at: string }> };

// F304
export const importPosSettlementBatch = (input: {
  storeId?: string | null;
  paymentMethod: string;
  providerKey: string;
  batchReference: string;
  settlementDate: string;
  entries: Array<{ providerReference: string; amount: number; feeAmount?: number; settledAt?: string }>;
}) => post<{ batch: Record<string, unknown>; entries: Array<Record<string, unknown>>; replayed: boolean }>("/settlements", input);

export const generatePosReconciliation = (reportId: string) =>
  post<{ reportId: string; reconciliations: PosReconciliation[]; replayed: boolean }>(`/reports/day-end/${reportId}/reconciliation`, {});

export const listPosReconciliations = (query: { storeId?: string; dayEndReportId?: string; status?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.storeId) params.set("storeId", query.storeId);
  if (query.dayEndReportId) params.set("dayEndReportId", query.dayEndReportId);
  if (query.status) params.set("status", query.status);
  return request<{ rows: PosReconciliation[] }>(`/reconciliations${params.size ? `?${params}` : ""}`);
};

export const getPosReconciliation = (id: string) => request<PosReconciliationDetail>(`/reconciliations/${id}`);

export const resolvePosReconciliation = (id: string, resolutionNotes: string) =>
  post<{ reconciliation: PosReconciliation }>(`/reconciliations/${id}/resolve`, { resolutionNotes });

export const recordPosReconciliationCorrection = (id: string, reason: string) =>
  post<{ correction: Record<string, unknown> }>(`/reconciliations/${id}/correction`, { reason });
