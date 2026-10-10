"use client";

import { request } from "@/features/pos/shared/http";

// The cashiers a POS screen filters by (shifts, cash movements, transactions), keyed by their workspace user. Cashiers themselves are
// maintained in POS → Cashiers (features/pos/cashiers).
export type PosCashierOption = { id: string; fullName: string; email: string; code: string };

export const listPosEligibleCashiers = () =>
  request<{ cashiers: Array<{ userId: string; name: string; email: string; code: string }> }>("/cashiers").then((result) => ({
    rows: result.cashiers.map((cashier): PosCashierOption => ({ id: cashier.userId, fullName: `${cashier.code} · ${cashier.name}`, email: cashier.email, code: cashier.code })),
  }));
