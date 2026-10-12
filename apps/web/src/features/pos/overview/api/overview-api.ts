"use client";

import { request } from "@/features/pos/shared/http";

export type PosDashboard = {
  sales_today: number;
  revenue_today: string;
  open_shifts: number;
  returns_today: number;
  tenders: Array<{ method: string; amount: string; payments: number }>;
  activeShifts: Array<{ id: string; number: string; status: string; openedAt: string; terminal: string; outlet: string; cashier: string | null }>;
  attention: { pendingPayments: number; pendingCheckouts: number; openRefunds: number; openCashDifferences: number; openPaymentExceptions: number; heldCarts: number };
  businessDays: Array<{ outletId: string; outlet: string; businessDate: string; status: string; zReportId: string | null }>;
};
export const getPosDashboard = () => request<PosDashboard>("/dashboard");
export {
  listPosShifts,
} from "@/features/pos/shifts/api/shifts-api";
export {
  listPosCashMovements,
  recordPosCashMovement,
} from "@/features/pos/cash-movements/api/cash-movements-api";
