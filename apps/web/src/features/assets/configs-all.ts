"use client";

import type { RegisterConfig } from "@/features/assets/shared/Register";
import { CORE_REGISTERS } from "@/features/assets/configs";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = { ...CORE_REGISTERS };
