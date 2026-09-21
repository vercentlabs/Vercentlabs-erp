"use client";

import { REGISTERS } from "@/features/quality/configs-all";
import { QualityDashboardScreen } from "@/features/quality/screens/DashboardScreen";
import { PlanBuilderScreen } from "@/features/quality/screens/PlanBuilderScreen";
import { InspectionNewScreen } from "@/features/quality/screens/InspectionScreens";
import { Register } from "@/features/quality/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function QualityPage({ name }: { name: string }) {
  if (name === "plan-builder") return <PlanBuilderScreen />;
  if (name === "inspection-new") return <InspectionNewScreen />;
  const config = REGISTERS[name];
  if (!config) return null;
  return <Register config={config} />;
}

export { QualityDashboardScreen };
