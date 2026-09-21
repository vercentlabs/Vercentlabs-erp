"use client";

import { REGISTERS } from "@/features/projects/configs-all";
import { ProjectsDashboardScreen } from "@/features/projects/screens/DashboardScreen";
import { ReportsScreen } from "@/features/projects/screens/ReportScreen";
import { ProjectsSettingsScreen } from "@/features/projects/screens/SettingsScreen";
import { WorkspaceScreen } from "@/features/projects/screens/WorkspaceScreen";
import { Register } from "@/features/projects/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function ProjectsPage({ name }: { name: string }) {
  if (name === "reports") return <ReportsScreen />;
  if (name === "settings") return <ProjectsSettingsScreen />;
  if (name === "workspace" || name === "capacity") return <WorkspaceScreen />;
  const config = REGISTERS[name];
  if (!config) return null;
  return <Register config={config} />;
}

export { ProjectsDashboardScreen };
