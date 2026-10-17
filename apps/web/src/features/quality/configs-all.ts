"use client";

import type { RegisterConfig } from "@/features/quality/shared/Register";
import { NC_REGISTERS } from "@/features/quality/configs-nc";
import { INSPECTION_REGISTERS } from "@/features/quality/configs-inspections";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = {
  ...NC_REGISTERS,
  ...INSPECTION_REGISTERS,
};
