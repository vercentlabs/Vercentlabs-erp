"use client";

import { REGISTERS } from "@/features/support/configs-all";
import { SupportDashboardScreen } from "@/features/support/screens/TicketScreens";
import { CsatReportScreen, AgentPerformanceScreen, SlaReportScreen } from "@/features/support/screens/ReportScreens";
import { Register } from "@/features/support/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
const ALIASES: Record<string, string> = { "my-tickets": "my-agent-tickets", "portal-tickets": "my-tickets", "portal-articles": "my-knowledge" };

export function SupportPage({ name }: { name: string }) {
  if (name === "csat") return <CsatReportScreen />;
  if (name === "agent-performance") return <AgentPerformanceScreen />;
  if (name === "sla-reports") return <SlaReportScreen />;
  const config = REGISTERS[ALIASES[name] ?? name];
  if (!config) return null;
  return <Register config={config} />;
}

export { SupportDashboardScreen };
