"use client";

import type { RegisterConfig } from "@/features/hr/shared/Register";
import { REGISTERS as WORKFORCE } from "@/features/hr/configs";
import { RECRUITMENT_REGISTERS } from "@/features/hr/configs-recruitment";
import { TIME_REGISTERS } from "@/features/hr/configs-time";
import { PAYROLL_REGISTERS } from "@/features/hr/configs-payroll";
import { INPUT_REGISTERS } from "@/features/hr/configs-inputs";
import { CLOSE_REGISTERS } from "@/features/hr/configs-close";
import { STATUTORY_REGISTERS } from "@/features/hr/configs-statutory";
import { PERFORMANCE_REGISTERS } from "@/features/hr/configs-performance";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = { ...WORKFORCE, ...RECRUITMENT_REGISTERS, ...TIME_REGISTERS, ...PAYROLL_REGISTERS, ...INPUT_REGISTERS, ...CLOSE_REGISTERS, ...STATUTORY_REGISTERS, ...PERFORMANCE_REGISTERS };
