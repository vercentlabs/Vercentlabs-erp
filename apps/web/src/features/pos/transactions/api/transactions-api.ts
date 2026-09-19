"use client";

import { request } from "@/features/pos/shared/http";
import type { PosTransactionDetail, PosTransactionListFilters, PosTransactionRow } from "@/features/pos/transactions/types/transactions";

// The Transactions workspace's search screen and its detail drill-down --
// both read through GET /api/pos/sales (list) and GET /api/pos/sales/[id]
// (detail), which wrap listPosTransactions/getPosTransactionDetail
// (services/api/src/modules/point-of-sale/transaction-continuity-and-
// documents/transactions.js). Nothing here computes a total or a status --
// every field is exactly what the server persisted.
export const listPosTransactions = (query: PosTransactionListFilters = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
  );
  return request<{ rows: PosTransactionRow[]; total: number }>(`/sales${params.size ? `?${params}` : ""}`);
};

export const getPosTransaction = (saleId: string) => request<PosTransactionDetail>(`/sales/${saleId}`);
