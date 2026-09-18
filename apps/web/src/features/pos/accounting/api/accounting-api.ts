"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosAccountingPostingRow = {
  id: string;
  document_type: "pos_sale" | "pos_return";
  document_number: string;
  store_id: string;
  grand_total: string;
  currency_code: string | null;
  accounting_posting_status: "pending" | "posted" | "failed" | "not_applicable";
  accounting_posting_error: string | null;
  accounting_posted_at: string | null;
  completed_at: string;
};
export type PosAccountingPostingOutcome = { posted: boolean; replayed?: boolean; failed?: boolean; journalEntryId?: string; message?: string };

// F305
export const postPosSaleToAccounting = (saleId: string) => post<PosAccountingPostingOutcome>(`/sales/${saleId}/accounting-post`);
export const postPosReturnToAccounting = (returnId: string) => post<PosAccountingPostingOutcome>(`/returns/${returnId}/accounting-post`);
export const postPosDayEndReportToAccounting = (reportId: string) =>
  post<{
    reportId: string;
    posted: Array<{ type: string; id: string; journalEntryId: string }>;
    alreadyPosted: Array<{ type: string; id: string }>;
    failed: Array<{ type: string; id: string; message: string }>;
  }>(`/reports/day-end/${reportId}/accounting-post`);
export const listPosAccountingPostingQueue = (query: { status?: string; storeId?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.storeId) params.set("storeId", query.storeId);
  return request<{ rows: PosAccountingPostingRow[] }>(`/accounting/posting-queue${params.size ? `?${params}` : ""}`);
};
