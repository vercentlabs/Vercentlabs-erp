"use client";

import { request } from "@/features/pos/shared/http";

export type PosDashboard = { sales_today: number; revenue_today: string; open_shifts: number; returns_today: number };
export const getPosDashboard = () => request<PosDashboard>("/dashboard");

// The overview dashboard's own quick shift-open/close and paid-in/paid-out
// actions reuse the exact same mutation logic as the dedicated /pos/shifts
// and /pos/cash-movement workspaces -- re-exported here rather than
// duplicated, so there is exactly one implementation of each mutation to
// keep in sync with the backend's idempotency contract.
export type { PosShift } from "@/features/pos/shifts/api/shifts-api";
export { openPosShift, closePosShift, listPosShifts } from "@/features/pos/shifts/api/shifts-api";
export type { PosCashMovement } from "@/features/pos/cash-movements/api/cash-movements-api";
export { listPosCashMovements, recordPosCashMovement } from "@/features/pos/cash-movements/api/cash-movements-api";
