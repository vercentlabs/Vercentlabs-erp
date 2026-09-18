"use client";

import { request, post } from "@/features/pos/shared/http";
import type { PosOfflineSnapshot, PosOfflineSyncResult } from "@/features/pos/offline/types";

// F297/F298 — offline POS workspace + offline-to-online sync
export const getPosOfflineSnapshot = (storeId: string) => request<{ snapshot: PosOfflineSnapshot }>(`/offline/snapshot?storeId=${storeId}`);

export type PosOfflineSyncTransaction = {
  localTransactionId: string;
  storeId: string;
  terminalId?: string | null;
  shiftId: string;
  lines: Array<{ itemId: string; variantId?: string | null; quantity: number; capturedUnitPrice: number; discountAmount?: number | null; discountReason?: string | null; description?: string | null }>;
  payments: Array<{ method: "cash"; amount: number }>;
  customerName?: string | null;
  roundingAdjustment?: number;
  capturedAt?: string | null;
};
export const syncOfflinePosSales = (transactions: PosOfflineSyncTransaction[]) =>
  post<{ results: PosOfflineSyncResult[] }>("/offline/sync", { transactions });

export type PosOfflineSyncConflict = {
  id: string;
  local_transaction_id: string;
  conflict_type: string;
  status: "pending" | "resolved_retried" | "resolved_voided";
  detail: string | null;
  captured_payload: Record<string, unknown>;
  server_context_snapshot: Record<string, unknown>;
  created_at: string;
  [key: string]: unknown;
};
export const listPosOfflineSyncConflicts = (status?: string) =>
  request<{ conflicts: PosOfflineSyncConflict[] }>(`/offline/conflicts${status ? `?status=${status}` : ""}`);
export const resolvePosOfflineSyncConflict = (id: string, input: Record<string, unknown>) =>
  post<{ conflict: PosOfflineSyncConflict }>(`/offline/conflicts/${id}/resolve`, input);
