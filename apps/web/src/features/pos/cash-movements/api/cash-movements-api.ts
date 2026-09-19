"use client";

import { request, post } from "@/features/pos/shared/http";

// F300 -- paid-in/paid-out cash movements. Shared by the overview
// dashboard's own quick-action form (which re-exports these same
// functions rather than owning a second copy) and this dedicated
// cash-movement history workspace.
export type PosCashMovement = {
  id: string;
  shift_id: string;
  movement_number: string;
  movement_type: "opening" | "paid_in" | "paid_out" | "sale" | "refund";
  amount: string;
  reason: string;
  created_by: string;
  created_at: string;
};

export const listPosCashMovements = (shiftId: string) => request<{ rows: PosCashMovement[] }>(`/shifts/${shiftId}/cash-movements`);

export const recordPosCashMovement = (
  shiftId: string,
  input: { movementType: "paid_in" | "paid_out"; amount: number; reason: string; idempotencyKey: string },
) => post<{ movement: PosCashMovement }>(`/shifts/${shiftId}/cash-movements`, input);

export type PosCashMovementHistoryFilters = {
  storeId?: string;
  terminalId?: string;
  shiftId?: string;
  movementType?: string;
  cashierUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

// Cross-shift history, unlike listPosCashMovements above (a single shift's
// own movements) -- goes through the generic resource-listing endpoint
// (see resource-registry.js's "cash-movements" table) with withTotal for
// real server-side pagination.
export const listPosCashMovementHistory = (query: PosCashMovementHistoryFilters = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
  );
  params.set("withTotal", "1");
  return request<{ rows: PosCashMovement[]; total: number }>(`/cash-movements?${params}`);
};
