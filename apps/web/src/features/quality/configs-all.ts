"use client";

import type { RegisterConfig } from "@/features/quality/shared/Register";
import { CORE_REGISTERS } from "@/features/quality/configs";
import { NC_REGISTERS } from "@/features/quality/configs-nc";
import { INSPECTION_REGISTERS } from "@/features/quality/configs-inspections";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = {
  ...CORE_REGISTERS,
  ...NC_REGISTERS,
  ...INSPECTION_REGISTERS,
};
