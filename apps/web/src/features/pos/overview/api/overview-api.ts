"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosDashboard = { sales_today: number; revenue_today: string; open_shifts: number; returns_today: number };
export const getPosDashboard = () => request<PosDashboard>("/dashboard");

export type PosShift = {
  id: string;
  storeId?: string;
  store_id?: string;
  terminalId?: string;
  terminal_id?: string;
  status: string;
  shiftNumber?: string;
  shift_number?: string;
  openingCash?: string;
  opening_cash?: string;
};
export const openPosShift = (input: Record<string, unknown>) => post<{ shift: PosShift }>("/shifts", input);
export const closePosShift = (id: string, input: Record<string, unknown>) => post<{ shift: PosShift }>(`/shifts/${id}/close`, input);
export const listPosShifts = (query: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
  return request<{ rows: PosShift[] }>(`/shifts${params.size ? `?${params}` : ""}`);
};

// F300 -- paid-in/paid-out cash movements.
export type PosCashMovement = { id: string; movement_number: string; movement_type: string; amount: string; reason: string; created_at: string };
export const listPosCashMovements = (shiftId: string) => request<{ rows: PosCashMovement[] }>(`/shifts/${shiftId}/cash-movements`);
export const recordPosCashMovement = (shiftId: string, input: { movementType: "paid_in" | "paid_out"; amount: number; reason: string; idempotencyKey: string }) =>
  post<{ movement: PosCashMovement }>(`/shifts/${shiftId}/cash-movements`, input);
