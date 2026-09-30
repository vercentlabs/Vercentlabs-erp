"use client";

import type { RegisterConfig } from "@/features/support/shared/Register";
import { CORE_REGISTERS } from "@/features/support/configs";
import { ticketsRegister } from "@/features/support/screens/TicketScreens";

// Every register in the module, by page name.
export const REGISTERS: Record<string, RegisterConfig> = {
  ...CORE_REGISTERS,
  tickets: ticketsRegister("all"),
  "my-agent-tickets": ticketsRegister("mine"),
  unassigned: ticketsRegister("unassigned"),
};
