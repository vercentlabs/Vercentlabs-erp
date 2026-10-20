"use client";

import type { RegisterConfig } from "@/features/quality/shared/Register";
import { NC_REGISTERS } from "@/features/quality/configs-nc";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = {
  ...NC_REGISTERS,
};
