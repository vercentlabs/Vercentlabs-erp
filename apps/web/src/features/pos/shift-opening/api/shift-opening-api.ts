"use client";

// POS Shift Opening (0103): the counters this cashier may open, a preview of opening one, opening it, the current shift, opening a cash drawer
// on a card / UPI shift, and the openings report.
import { request } from "@/features/pos/shared/http";

export type PaymentMethods = { cash: boolean; card: boolean; upi: boolean };
export type Warning = { code: string; message: string };
export type Handover = { id: string; fromShiftNumber?: string; handedOverBy?: string | null; handedOverAt?: string; amount?: string; variance?: string | null; reason?: string | null; approved?: boolean };
export type ShiftView = {
  shiftId: string; shiftNumber: string; status: string; storeId: string; storeName: string; terminalId: string; terminalCode: string; terminalName: string; cashierUserId: string;
  cashierName: string | null; openedAt: string; closedAt: string | null; cashEnabled: boolean; cashSessionId: string | null; cashSessionStatus: string | null; openingCashAmount: string | null;
  currency: string; openingSource: string | null; previousShiftNumber: string | null; handover: Handover | null; paymentMethods: PaymentMethods; readyForCheckout: boolean; version: number;
  suspension?: ShiftLifecycle["suspension"]; review?: ShiftLifecycle["review"];
  sourceType?: CashSource | null; sourceReference?: string | null; cashDrawer?: { id: string; code: string; name: string } | null; openingCorrections?: number;
};
export type Counter = { terminalId: string; code: string; name: string; storeId: string; storeName: string; cashCounter: boolean; occupied: boolean; mine: boolean; occupiedBy: string | null };
export type OpeningPreview = {
  action: "OPEN" | "RESTORE"; shift?: ShiftView; terminalId: string; terminalCode: string; storeId: string; storeName: string; terminalVersion: number; cashEnabled: boolean;
  openingCashAmount: string | null; handover: Handover | null; approvalRequired: boolean; approvalFingerprint: string | null; approvalAmount: string | null; paymentMethods: PaymentMethods;
  cashDrawer: { id: string | null; code: string; name: string; createdOnOpening: boolean } | null; sourceType: CashSource | null; varianceReasonRequired: boolean; varianceBlocked: boolean;
  warnings: Warning[];
  readyToOpen: boolean;
};
export type OpeningContext = {
  company: string | null; currentShift: ShiftView | null; counters: Counter[]; selectedTerminalId: string | null; denominations: number[];
  readiness: (OpeningPreview & { blocked?: undefined }) | { blocked: { code: string; message: string } } | null;
};
export type CashSource = "FRESH_FLOAT" | "HANDOVER" | "EXISTING_DRAWER" | "ZERO_FLOAT";
export type OpenInput = {
  terminalId: string; cashEnabled: boolean; sourceType?: CashSource; sourceReference?: string; handoverId?: string; openingCash?: string; denominations?: Array<{ denomination: number; count: number }>; openingCashConfirmed?: boolean;
  varianceReason?: string; approvalId?: string | null; expectedTerminalVersion?: number; idempotencyKey: string;
};

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const openingContext = (terminalId?: string | null) =>
  request<{ context: OpeningContext }>(`/shift-opening/context${terminalId ? `?terminalId=${encodeURIComponent(terminalId)}` : ""}`).then((result) => result.context);
export const previewOpening = (input: Omit<OpenInput, "idempotencyKey" | "openingCashConfirmed" | "varianceReason" | "approvalId" | "expectedTerminalVersion">) =>
  post<{ preview: OpeningPreview }>("/shifts/opening-preview", input).then((result) => result.preview);
export const openShift = (input: OpenInput) => post<{ shift: ShiftView & { restored?: boolean } }>("/shifts/open", input).then((result) => result.shift);
export const currentShift = () => request<{ shift: ShiftView | null }>("/shifts/current").then((result) => result.shift);
export const openCashDrawer = (shiftId: string, input: { openingCash: string; openingCashConfirmed: boolean; varianceReason?: string; approvalId?: string | null }) =>
  post<{ shift: ShiftView }>(`/shifts/${shiftId}/cash-session`, input).then((result) => result.shift);

export type OpeningSummary = {
  from: string; to: string;
  totals: { openings: number; cashShifts: number; digitalShifts: number; openingFloats: string; variances: number; varianceTotal: string; approvedOpenings: number; handoversWaiting: number;
    openingCorrections?: number };
  floatsBySource?: Array<{ source: string; openings: number; amount: string }>;
  openByOutlet: Array<{ outlet: string; openShifts: number; activeCounters: number }>;
  longOpen: Array<{ shiftId: string; shiftNumber: string; terminal: string; cashier: string | null; openedAt: string }>;
  refusals: Array<{ code: string; attempts: number }>; longOpenHours: number;
};
export const openingSummary = () => request<{ summary: OpeningSummary }>("/reports/shift-openings").then((result) => result.summary);

// The rest of the lifecycle: pause, resume (the cashier signs in again), a supervisor's review.
export type ShiftLifecycle = { suspension: { at: string; reason: string | null; byCashier: boolean } | null;
  review: { reason: string | null; flaggedAt: string; resolution: string | null; resolvedAt: string | null } | null };
export const pauseShift = (shiftId: string, reason?: string) => post<{ shift: ShiftView }>(`/shifts/${shiftId}/suspend`, { reason }).then((result) => result.shift);
export const resumeShift = (shiftId: string, password: string) => post<{ shift: ShiftView }>(`/shifts/${shiftId}/resume`, { password }).then((result) => result.shift);
export const flagShiftForReview = (shiftId: string, reason: string) => post<{ shift: ShiftView }>(`/shifts/${shiftId}/recovery`, { reason }).then((result) => result.shift);
export const clearShiftReview = (shiftId: string, resolution: string) =>
  post<{ shift: ShiftView }>(`/shifts/${shiftId}/recovery-resolve`, { resolution }).then((result) => result.shift);
export const shiftSession = (shiftId: string) => request<{ shift: ShiftView }>(`/shifts/${shiftId}/session`).then((result) => result.shift);
