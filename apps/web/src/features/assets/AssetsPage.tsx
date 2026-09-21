"use client";

import { REGISTERS } from "@/features/assets/configs-all";
import { AssetsDashboardScreen } from "@/features/assets/screens/DashboardScreen";
import { ReportsScreen } from "@/features/assets/screens/ReportScreen";
import { AssetsSettingsScreen } from "@/features/assets/screens/SettingsScreen";
import { VerificationScreen } from "@/features/assets/screens/VerificationScreen";
import { Register } from "@/features/assets/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function AssetsPage({ name }: { name: string }) {
  if (name === "analytics") return <AssetsDashboardScreen />;
  if (name === "reports") return <ReportsScreen />;
  if (name === "settings") return <AssetsSettingsScreen />;
  if (name === "physical-verification") return <VerificationScreen />;
  const config = REGISTERS[name];
  if (!config) return null;
  return <Register config={config} />;
}

export { AssetsDashboardScreen };
