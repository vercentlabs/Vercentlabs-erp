"use client";

import { REGISTERS } from "@/features/hr/configs-all";
import { HrSettingsScreen, MyProfileScreen, OrgChartScreen } from "@/features/hr/screens/WorkforceScreens";
import { LeaveAdminScreen, MyAttendanceScreen } from "@/features/hr/screens/TimeScreens";
import { PayrollHomeScreen } from "@/features/hr/screens/PayrollScreens";
import { ComplianceReportScreen } from "@/features/hr/screens/StatutoryScreens";
import { Register } from "@/features/hr/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
const ALIASES: Record<string, string> = { positions: "designations", "pay-components": "salary-components" };

export function HrPage({ name }: { name: string }) {
  if (name === "organization") return <OrgChartScreen />;
  if (name === "me") return <MyProfileScreen />;
  if (name === "my-attendance") return <MyAttendanceScreen />;
  if (name === "leave-admin") return <LeaveAdminScreen />;
  if (name === "payroll") return <PayrollHomeScreen />;
  if (name === "compliance-report") return <ComplianceReportScreen />;
  if (name === "settings") return <HrSettingsScreen />;
  const config = REGISTERS[ALIASES[name] ?? name];
  if (!config) return null;
  return <Register config={config} />;
}
