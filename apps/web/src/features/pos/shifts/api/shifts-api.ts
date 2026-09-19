"use client";

import { request, post } from "@/features/pos/shared/http";

// F301/F302 -- shift open/close. Shared by the overview dashboard's quick
// actions (which re-export these same functions rather than owning a
// second copy) and this dedicated shifts workspace.
export type PosShift = {
  id: string;
  store_id: string;
  terminal_id: string;
  shift_number: string;
  cashier_user_id: string;
  status: "open" | "closed";
  opening_cash: string;
  expected_cash: string;
  counted_cash: string | null;
  cash_variance: string | null;
  opened_at: string;
  opened_by: string;
  closed_at: string | null;
  closed_by: string | null;
  close_notes: string | null;
};

export type PosShiftFilters = {
  storeId?: string;
  terminalId?: string;
  status?: string;
  cashierUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export const openPosShift = (input: Record<string, unknown>) => post<{ shift: PosShift }>("/shifts", input);
export const closePosShift = (id: string, input: Record<string, unknown>) => post<{ shift: PosShift }>(`/shifts/${id}/close`, input);

export const listPosShifts = (query: PosShiftFilters = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
  );
  return request<{ rows: PosShift[] }>(`/shifts${params.size ? `?${params}` : ""}`);
};

// Same endpoint as listPosShifts, but asks the server for a total row
// count (see resource-registry.js's opt-in `withTotal`) for real
// server-side pagination -- the overview dashboard's own quick-action
// lookups never need a total, so they keep using listPosShifts above.
export const listPosShiftsPage = (query: PosShiftFilters = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
  );
  params.set("withTotal", "1");
  return request<{ rows: PosShift[]; total: number }>(`/shifts?${params}`);
};

export type PosShiftSaleSummary = { id: string; receipt_number: string; customer_name: string | null; grand_total: string; status: string; created_at: string };
export type PosShiftPaymentBreakdown = { payment_method: string; status: string; amount: string; count: number };
export type PosCashMovement = { id: string; movement_number: string; movement_type: string; amount: string; reason: string; created_by: string; created_at: string };

export type PosShiftDetail = PosShift & {
  cashMovements: PosCashMovement[];
  sales: PosShiftSaleSummary[];
  paymentBreakdown: PosShiftPaymentBreakdown[];
};

export const getPosShift = (id: string) => request<{ shift: PosShiftDetail }>(`/shifts/${id}`);
