"use client";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// Whether an app (module key, e.g. "stock") is on for this workspace and open to this person. A screen hides another app's tabs,
// buttons, fields and warnings when it is off; the server makes the same decision for the work itself (core/access/apps.js).
export function useApp(app: string) {
  return useWorkspaceContext().accessibleModuleKeys.includes(app);
}

// Every app another one can light up, at once (Sales plan): one answer for the sidebar, tabs, buttons, filters and + Create.
export function useApps() {
  const keys = useWorkspaceContext().accessibleModuleKeys;
  return { stock: keys.includes("stock"), accounting: keys.includes("accounting"), crm: keys.includes("crm"), pos: keys.includes("point-of-sale"),
    manufacturing: keys.includes("manufacturing") };
}
