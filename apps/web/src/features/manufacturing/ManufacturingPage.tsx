"use client";

import { REGISTERS } from "@/features/manufacturing/configs";
import { StandardCostScreen } from "@/features/manufacturing/screens/AnalyticsScreens";
import { MaterialPlanningScreen } from "@/features/manufacturing/screens/PlanningScreens";
import { SettingsScreen } from "@/features/manufacturing/screens/OrderDetailScreen";
import { Register } from "@/features/manufacturing/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function ManufacturingPage({ name }: { name: string }) {
  if (name === "standard-cost") return <StandardCostScreen />;
  if (name === "material-planning") return <MaterialPlanningScreen />;
  if (name === "settings") return <SettingsScreen />;
  const config = REGISTERS[name];
  if (!config) return null;
  return <Register config={config} />;
}
