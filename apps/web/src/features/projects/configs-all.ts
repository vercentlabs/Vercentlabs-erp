"use client";

import type { RegisterConfig } from "@/features/projects/shared/Register";
import { CORE_REGISTERS } from "@/features/projects/configs";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = { ...CORE_REGISTERS };
