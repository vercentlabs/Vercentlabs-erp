"use client";

// POS Opening Cash Float (0104): a cash session's confirmed opening count, corrections beside it, the expected drawer cash, and cash drawers.
import { request } from "@/features/pos/shared/http";

export type OpeningCount = {
  openingCountId: string; cashSessionId: string; shiftId: string; shiftNumber: string; cashDrawer: { id: string; code: string; name: string } | null; terminalCode: string;
  storeName: string; currency: string; openingAmount: string; sourceType: string | null; sourceReference: string | null;
  denominations: Array<{ denomination: number; count: number; amount: string }> | null; confirmedBy: string | null; confirmedAt: string;
  handover: { id: string; fromShiftNumber: string | null; amount?: string; closingCounted?: string; removed?: string; removalNote?: string | null } | null;
  variance: string | null; varianceReason: string | null; approval: { id: string; approver?: string | null } | null;
};
export type ExpectedBalance = { expectedCash: string; currency: string; countedAtClose: string | null; closingVariance: string | null;
  breakdown: { openingFloat: string; cashReceived: string; changeGiven: string; uncompletedTendersReturned: string; cashRefundsPaid: string; cashMovementIn: string; cashMovementOut: string;
    closingAdjustments: string } };
export type Correction = { id: string; confirmedAmount: string; correctedAmount: string; difference: string; reason: string; recordedBy: string | null; recordedAt: string };
export type CashSession = { id: string; shiftId: string; shiftNumber: string; status: string; shiftStatus: string; openedAt: string; closedAt: string | null; openingCount: OpeningCount;
  corrections: Correction[]; expected: ExpectedBalance | null };
export type CashDrawer = { id: string; storeId: string; storeName: string; code: string; name: string; status: "active" | "inactive"; terminals: string[]; heldByShift: string | null;
  heldBy: string | null };

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const SOURCE_LABEL: Record<string, string> = { FRESH_FLOAT: "Fresh float", HANDOVER: "Handover from the previous shift", EXISTING_DRAWER: "Cash already in the drawer", ZERO_FLOAT: "No cash (₹0)" };
export const cashSession = (id: string) => request<{ cashSession: CashSession }>(`/cash-sessions/${id}`).then((result) => result.cashSession);
export const correctOpening = (id: string, input: { correctedAmount: string; reason: string }) =>
  post<{ cashSession: CashSession }>(`/cash-sessions/${id}/opening-corrections`, input).then((result) => result.cashSession);
export const listDrawers = (storeId: string) => request<{ drawers: CashDrawer[] }>(`/cash-drawers?storeId=${encodeURIComponent(storeId)}`).then((result) => result.drawers);
export const saveDrawer = (input: { id?: string; storeId?: string; code: string; name: string; status?: "active" | "inactive" }) =>
  post<{ drawer: { id: string } }>("/cash-drawers", input).then((result) => result.drawer);
export const assignDrawer = (terminalId: string, drawerId: string) => post<{ assignment: { cashDrawerId: string } }>(`/terminals/${terminalId}/cash-drawer`, { drawerId });
