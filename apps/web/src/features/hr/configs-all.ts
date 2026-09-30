"use client";

import type { RegisterConfig } from "@/features/hr/shared/Register";
import { REGISTERS as WORKFORCE } from "@/features/hr/configs";
import { TIME_REGISTERS } from "@/features/hr/configs-time";
import { PAYROLL_REGISTERS } from "@/features/hr/configs-payroll";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = {
  ...WORKFORCE,
  ...TIME_REGISTERS,
  ...PAYROLL_REGISTERS,
};
