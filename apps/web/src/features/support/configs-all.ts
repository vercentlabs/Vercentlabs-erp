"use client";

import type { RegisterConfig } from "@/features/support/shared/Register";
import { CORE_REGISTERS } from "@/features/support/configs";
import { KNOWLEDGE_REGISTERS } from "@/features/support/configs-knowledge";
import { SERVICE_REGISTERS } from "@/features/support/configs-service";
import { PORTAL_REGISTERS } from "@/features/support/configs-portal";
import { escalationsRegister, ticketsRegister } from "@/features/support/screens/TicketScreens";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = {
  ...CORE_REGISTERS,
  ...KNOWLEDGE_REGISTERS,
  ...SERVICE_REGISTERS,
  ...PORTAL_REGISTERS,
  tickets: ticketsRegister("all"),
  "my-agent-tickets": ticketsRegister("mine"),
  unassigned: ticketsRegister("unassigned"),
  escalated: ticketsRegister("escalated"),
  breaches: ticketsRegister("breached"),
  "escalations-admin": escalationsRegister,
};
