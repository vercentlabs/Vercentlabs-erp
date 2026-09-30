"use client";

import { REGISTERS } from "@/features/support/configs-all";
import { SupportDashboardScreen } from "@/features/support/screens/TicketScreens";
import { Register } from "@/features/support/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
const ALIASES: Record<string, string> = {
  "my-tickets": "my-agent-tickets",
};

export function SupportPage({ name }: { name: string }) {
  const config = REGISTERS[ALIASES[name] ?? name];
  if (!config) return null;
  return <Register config={config} />;
}

export { SupportDashboardScreen };
