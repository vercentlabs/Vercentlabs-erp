"use client";

import { request } from "@/features/pos/shared/http";

export type PosDashboard = {
  sales_today: number;
  revenue_today: string;
  open_shifts: number;
  returns_today: number;
};
export const getPosDashboard = () => request<PosDashboard>("/dashboard");
export {
  openPosShift,
  closePosShift,
  listPosShifts,
} from "@/features/pos/shifts/api/shifts-api";
export {
  listPosCashMovements,
  recordPosCashMovement,
} from "@/features/pos/cash-movements/api/cash-movements-api";
