"use client";

import type { RegisterConfig } from "@/features/assets/shared/Register";

// The Assets desk registers still served by the generic register page. Every Assets area now has its own workspace (register, categories,
// custody, transfers, assignments, depreciation, maintenance, disposals), so none remain here.
export const CORE_REGISTERS: Record<string, RegisterConfig> = {};
